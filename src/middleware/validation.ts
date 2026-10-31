import { ApiError } from '../utils/http';

type FieldErrors = Record<string, string>;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const STUDENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{2,31}$/;
// Requires an explicit timezone so the Worker never guesses a wall-clock zone.
const ISO_WITH_ZONE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;

export class Fields {
  readonly errors: FieldErrors = {};

  private set(name: string, message: string): void {
    if (!this.errors[name]) this.errors[name] = message;
  }

  text(name: string, value: unknown, label: string, min: number, max: number): string {
    if (typeof value !== 'string') {
      this.set(name, `${label} is required.`);
      return '';
    }
    const trimmed = value.trim();
    if (!trimmed) this.set(name, `${label} is required.`);
    else if (trimmed.length < min) this.set(name, `${label} must be at least ${min} characters.`);
    else if (trimmed.length > max) this.set(name, `${label} must be at most ${max} characters.`);
    return trimmed;
  }

  optionalText(name: string, value: unknown, label: string, max: number): string {
    if (value === undefined || value === null || value === '') return '';
    if (typeof value !== 'string') {
      this.set(name, `${label} must be text.`);
      return '';
    }
    const trimmed = value.trim();
    if (trimmed.length > max) this.set(name, `${label} must be at most ${max} characters.`);
    return trimmed;
  }

  email(name: string, value: unknown): string {
    const email = this.text(name, value, 'Email address', 5, 254);
    if (email && !EMAIL_PATTERN.test(email)) this.set(name, 'Enter a valid email address.');
    return email.toLowerCase();
  }

  studentId(name: string, value: unknown): string {
    const id = this.text(name, value, 'Student ID', 3, 32);
    if (id && !STUDENT_ID_PATTERN.test(id)) {
      this.set(name, 'Student ID must be 3-32 characters using letters, numbers, dot, dash or underscore.');
    }
    return id;
  }

  password(name: string, value: unknown, label = 'Password'): string {
    if (typeof value !== 'string' || !value) {
      this.set(name, `${label} is required.`);
      return '';
    }
    if (value.length < 8) this.set(name, `${label} must be at least 8 characters.`);
    else if (value.length > 128) this.set(name, `${label} must be at most 128 characters.`);
    else if (!/[A-Za-z]/.test(value) || !/[0-9]/.test(value)) {
      this.set(name, `${label} must contain at least one letter and one number.`);
    }
    return value;
  }

  int(name: string, value: unknown, label: string, min: number, max: number): number {
    const parsed = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
    if (typeof parsed !== 'number' || !Number.isFinite(parsed) || !Number.isInteger(parsed)) {
      this.set(name, `${label} must be a whole number.`);
      return min;
    }
    if (parsed < min || parsed > max) {
      this.set(name, `${label} must be between ${min} and ${max}.`);
    }
    return parsed;
  }

  boolean(name: string, value: unknown, label: string): boolean {
    if (typeof value !== 'boolean') {
      this.set(name, `${label} must be true or false.`);
      return false;
    }
    return value;
  }

  isoDate(name: string, value: unknown, label: string): string {
    if (typeof value !== 'string' || !ISO_WITH_ZONE.test(value)) {
      this.set(name, `${label} must be a full date and time.`);
      return '';
    }
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) {
      this.set(name, `${label} is not a valid date.`);
      return '';
    }
    return new Date(parsed).toISOString();
  }

  oneOf<T extends string>(
    name: string,
    value: unknown,
    allowed: readonly T[],
    label: string,
    fallback: T,
  ): T {
    if (typeof value !== 'string' || !allowed.includes(value as T)) {
      this.set(name, `${label} is invalid.`);
      return fallback;
    }
    return value as T;
  }

  matches(name: string, first: string, second: string, message: string): void {
    if (first !== second) this.set(name, message);
  }

  check(name: string, condition: boolean, message: string): void {
    if (!condition) this.set(name, message);
  }

  done(): void {
    if (Object.keys(this.errors).length > 0) {
      throw new ApiError(422, 'VALIDATION_ERROR', 'Please correct the highlighted fields.', { ...this.errors });
    }
  }
}

export function intParam(params: Record<string, string>, name: string): number {
  const parsed = Number(params[name]);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ApiError(404, 'NOT_FOUND', 'The requested resource was not found.');
  }
  return parsed;
}
