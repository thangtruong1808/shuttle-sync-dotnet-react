export type FieldErrors = Record<string, string[]>;

const emailPattern = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function validateCredentials(email: string, password: string): FieldErrors {
  const errors: FieldErrors = {};
  const normalizedEmail = normalizeEmail(email);

  if (normalizedEmail.length === 0) {
    errors.email = ["Enter an email address."];
  } else if (normalizedEmail.length > 256) {
    errors.email = ["Email must be 256 characters or fewer."];
  } else if (!emailPattern.test(normalizedEmail)) {
    errors.email = ["Enter a valid email address."];
  }

  if (password.length === 0) {
    errors.password = ["Enter a password."];
  } else if (password.length < 12) {
    errors.password = ["Use at least 12 characters."];
  } else if (password.length > 128) {
    errors.password = ["Use at most 128 characters."];
  } else {
    const passwordErrors: string[] = [];
    if (!/\p{L}/u.test(password)) {
      passwordErrors.push("Include at least one letter.");
    }
    if (!/\p{N}/u.test(password)) {
      passwordErrors.push("Include at least one digit.");
    }
    const at = normalizedEmail.indexOf("@");
    const localPart = at > 0 ? normalizedEmail.slice(0, at) : "";
    if (localPart && password.toLowerCase().includes(localPart)) {
      passwordErrors.push("Password must not contain your email name.");
    }
    if (passwordErrors.length > 0) {
      errors.password = passwordErrors;
    }
  }

  return errors;
}
