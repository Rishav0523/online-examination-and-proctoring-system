/*
 * Royal Bengal Online Examination System — browser proctoring.
 *
 * Monitors only what the browser can legitimately observe: webcam presence
 * (via the MediaDevices API and a local face detector), tab visibility,
 * window focus and fullscreen state. Events are indicators for human review;
 * they are not proof of misconduct. No images or recordings are stored.
 */
(function (window, document) {
  'use strict';

  var MODEL_URI_PATH = 'assets/models';
  var FACE_INTERVAL_MS = 3000;
  var MISSES_BEFORE_NO_FACE = 2;
  var CLIENT_COOLDOWN_MS = 20000;
  var modelPromise = null;

  var EVENT_INFO = {
    NO_FACE_DETECTED: { severity: 'medium', message: 'No face is visible in the webcam preview.' },
    MULTIPLE_FACES_DETECTED: { severity: 'high', message: 'More than one face is visible in the webcam preview.' },
    CAMERA_DISCONNECTED: { severity: 'high', message: 'The webcam stopped or was disconnected.' },
    TAB_SWITCH: { severity: 'medium', message: 'The examination tab was hidden.' },
    WINDOW_BLUR: { severity: 'low', message: 'The examination window lost focus.' },
    FULLSCREEN_EXIT: { severity: 'medium', message: 'The examination left fullscreen mode.' },
  };

  function loadModels() {
    if (modelPromise) return modelPromise;
    if (!window.faceapi || !window.faceapi.nets || !window.faceapi.nets.tinyFaceDetector) {
      modelPromise = Promise.resolve(false);
      return modelPromise;
    }
    modelPromise = window.faceapi.nets.tinyFaceDetector
      .loadFromUri(window.RB.url(MODEL_URI_PATH))
      .then(function () {
        return true;
      })
      .catch(function (error) {
        console.warn('Face detection model could not be loaded:', error);
        return false;
      });
    return modelPromise;
  }

  function Proctor(options) {
    this.attemptId = options.attemptId;
    this.video = options.video;
    this.onEvent = options.onEvent || function () {};
    this.onStatus = options.onStatus || function () {};
    this.onWarning = options.onWarning || function () {};

    this.stream = null;
    this.faceLoop = null;
    this.watchLoop = null;
    this.active = false;
    this.modelsReady = false;
    this.detectorOptions = null;
    this.consecutiveMisses = 0;
    this.lastEventAt = {};
    this.lastStatusSignature = '';
    this.cameraRequested = false;
    this.fullscreenRequested = false;
    this.boundVisibility = this.handleVisibility.bind(this);
    this.boundBlur = this.handleBlur.bind(this);
    this.boundFullscreen = this.handleFullscreen.bind(this);
    this.status = {
      camera: 'off',
      face: 'unknown',
      models: 'pending',
      monitoring: false,
      events: 0,
    };
  }

  Proctor.prototype.emitStatus = function () {
    var signature = JSON.stringify(this.status);
    if (signature === this.lastStatusSignature) return;
    this.lastStatusSignature = signature;
    this.onStatus(Object.assign({}, this.status));
  };

  Proctor.prototype.startCamera = function () {
    var self = this;
    if (this.stream) {
      var live = this.stream.getVideoTracks().some(function (track) {
        return track.readyState === 'live';
      });
      if (live) {
        this.status.camera = 'live';
        this.emitStatus();
        return Promise.resolve({ ok: true, stream: this.stream });
      }
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      this.status.camera = 'unsupported';
      this.emitStatus();
      return Promise.resolve({ ok: false, reason: 'unsupported', message: 'This browser does not provide webcam access.' });
    }

    this.cameraRequested = true;
    return navigator.mediaDevices
      .getUserMedia({
        audio: false,
        video: {
          facingMode: 'user',
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 15, max: 24 },
        },
      })
      .then(function (stream) {
        self.stream = stream;
        if (self.video) {
          self.video.srcObject = stream;
          self.video.muted = true;
          self.video.playsInline = true;
          var playing = self.video.play();
          if (playing && playing.catch) playing.catch(function () {});
        }
        stream.getVideoTracks().forEach(function (track) {
          track.addEventListener('ended', function () {
            if (self.cameraRequested) self.handleCameraLoss('The webcam stream ended.');
          });
        });
        self.status.camera = 'live';
        self.consecutiveMisses = 0;
        self.emitStatus();
        return { ok: true, stream: stream };
      })
      .catch(function (error) {
        var reason = 'unavailable';
        var message = 'The webcam could not be started.';
        if (error && error.name === 'NotAllowedError') {
          reason = 'denied';
          message = 'Webcam permission was denied. Allow camera access in your browser settings, then try again.';
        } else if (error && error.name === 'NotFoundError') {
          reason = 'notfound';
          message = 'No webcam was found on this device.';
        } else if (error && error.name === 'NotReadableError') {
          reason = 'busy';
          message = 'The webcam is already in use by another application.';
        } else if (error && error.name === 'SecurityError') {
          reason = 'insecure';
          message = 'Webcam access requires a secure (HTTPS) connection.';
        }
        self.status.camera = reason === 'denied' ? 'denied' : 'off';
        self.emitStatus();
        return { ok: false, reason: reason, message: message };
      });
  };

  Proctor.prototype.loadFaceDetection = function () {
    var self = this;
    return loadModels().then(function (ready) {
      self.modelsReady = ready;
      self.status.models = ready ? 'ready' : 'unavailable';
      if (ready && window.faceapi) {
        self.detectorOptions = new window.faceapi.TinyFaceDetectorOptions({
          inputSize: 224,
          scoreThreshold: 0.45,
        });
      }
      self.emitStatus();
      return ready;
    });
  };

  Proctor.prototype.requestFullscreen = function () {
    var self = this;
    if (document.fullscreenElement || !document.documentElement.requestFullscreen) {
      return Promise.resolve(Boolean(document.fullscreenElement));
    }
    return document.documentElement
      .requestFullscreen({ navigationUI: 'hide' })
      .then(function () {
        self.fullscreenRequested = true;
        return true;
      })
      .catch(function () {
        return false;
      });
  };

  Proctor.prototype.start = function () {
    if (this.active) return;
    this.active = true;
    this.status.monitoring = true;
    this.emitStatus();

    document.addEventListener('visibilitychange', this.boundVisibility);
    window.addEventListener('blur', this.boundBlur);
    document.addEventListener('fullscreenchange', this.boundFullscreen);

    var self = this;
    this.faceLoop = window.setInterval(function () {
      self.detectFaces();
    }, FACE_INTERVAL_MS);
    this.watchLoop = window.setInterval(function () {
      self.watchCamera();
    }, 2500);
    window.setTimeout(function () {
      self.detectFaces();
    }, 800);
  };

  Proctor.prototype.detectFaces = function () {
    var self = this;
    if (!this.active) return;
    if (this.status.camera !== 'live' || !this.modelsReady || !this.detectorOptions) return;
    if (!this.video || this.video.readyState < 2 || !this.video.videoWidth) return;

    window.faceapi
      .detectAllFaces(this.video, this.detectorOptions)
      .then(function (detections) {
        if (!self.active) return;
        var count = detections.length;
        if (count === 0) {
          self.consecutiveMisses += 1;
          if (self.consecutiveMisses >= MISSES_BEFORE_NO_FACE) {
            self.status.face = 'none';
            self.emitStatus();
            self.report('NO_FACE_DETECTED', 'Face detection found no face in the preview.');
          }
          return;
        }
        self.consecutiveMisses = 0;
        if (count > 1) {
          self.status.face = 'multiple';
          self.emitStatus();
          self.report('MULTIPLE_FACES_DETECTED', count + ' faces detected in the preview.');
        } else {
          self.status.face = 'ok';
          self.emitStatus();
        }
      })
      .catch(function () {
        /* transient detector failure — do not emit a proctoring event */
      });
  };

  Proctor.prototype.watchCamera = function () {
    if (!this.active) return;
    if (this.cameraRequested && this.status.camera === 'live') {
      var tracks = this.stream ? this.stream.getVideoTracks() : [];
      var live = tracks.some(function (track) {
        return track.readyState === 'live';
      });
      if (!live) this.handleCameraLoss('The webcam track is no longer live.');
    }
  };

  Proctor.prototype.handleCameraLoss = function (detail) {
    if (!this.active || this.status.camera === 'off' || this.status.camera === 'denied') return;
    this.status.camera = 'off';
    this.status.face = 'unknown';
    this.emitStatus();
    this.report('CAMERA_DISCONNECTED', detail);
    this.onWarning('The webcam was disconnected. Reconnect it and enable the camera to continue monitored access.', 'danger');
  };

  Proctor.prototype.handleVisibility = function () {
    if (!this.active) return;
    if (document.hidden) {
      this.report('TAB_SWITCH', 'The examination tab became hidden.');
      this.onWarning('You switched away from the examination tab. This event has been recorded for review.', 'warning');
    }
  };

  Proctor.prototype.handleBlur = function () {
    if (!this.active || document.hidden) return;
    this.report('WINDOW_BLUR', 'The examination window lost focus.');
  };

  Proctor.prototype.handleFullscreen = function () {
    if (!this.active) return;
    if (!document.fullscreenElement) {
      this.report('FULLSCREEN_EXIT', 'Fullscreen mode was exited.');
      this.onWarning('You left fullscreen mode. This event has been recorded for review.', 'warning');
    }
  };

  Proctor.prototype.report = function (eventType, detail) {
    var info = EVENT_INFO[eventType];
    if (!info) return;
    var now = Date.now();
    if (this.lastEventAt[eventType] && now - this.lastEventAt[eventType] < CLIENT_COOLDOWN_MS) {
      return;
    }
    this.lastEventAt[eventType] = now;
    this.status.events += 1;
    this.emitStatus();
    this.onEvent(eventType, info.message, info.severity);

    if (!this.attemptId || !window.RB) return;
    window.RB.api('api/student/attempts/' + this.attemptId + '/proctor-events', {
      method: 'POST',
      json: { eventType: eventType, detail: detail || '' },
    }).catch(function (error) {
      // An expired or submitted attempt rejects further events; nothing to do.
      console.warn('Proctoring event was not stored:', error && error.message);
    });
  };

  Proctor.prototype.stop = function (options) {
    var opts = options || {};
    this.active = false;
    this.status.monitoring = false;
    this.emitStatus();

    document.removeEventListener('visibilitychange', this.boundVisibility);
    window.removeEventListener('blur', this.boundBlur);
    document.removeEventListener('fullscreenchange', this.boundFullscreen);

    if (this.faceLoop) window.clearInterval(this.faceLoop);
    if (this.watchLoop) window.clearInterval(this.watchLoop);
    this.faceLoop = null;
    this.watchLoop = null;

    if (this.stream) {
      this.stream.getTracks().forEach(function (track) {
        try {
          track.stop();
        } catch (error) {
          /* ignore */
        }
      });
      this.stream = null;
    }
    this.cameraRequested = false;
    if (this.video) this.video.srcObject = null;
    this.status.camera = 'off';
    this.status.face = 'unknown';
    this.emitStatus();

    if (opts.exitFullscreen !== false && document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(function () {});
    }
  };

  window.RBProctor = {
    create: function (options) {
      return new Proctor(options);
    },
    loadModels: loadModels,
    eventTypes: Object.keys(EVENT_INFO),
  };
})(window, document);
