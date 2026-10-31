export type FieldErrors = Record<string, string[]>;

const emailPattern = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function validateEmail(email: string): string[] {
  const normalizedEmail = normalizeEmail(email);
  if (normalizedEmail.length === 0) {
    return ["Enter an email address."];
  }
  if (normalizedEmail.length > 256) {
    return ["Email must be 256 characters or fewer."];
  }
  if (!emailPattern.test(normalizedEmail)) {
    return ["Enter a valid email address."];
  }
  return [];
}

export function validatePassword(password: string, email: string): string[] {
  if (password.length === 0) {
    return ["Enter a password."];
  }
  if (password.length < 12) {
    return ["Use at least 12 characters."];
  }
  if (password.length > 128) {
    return ["Use at most 128 characters."];
  }
  const passwordErrors: string[] = [];
  if (!/\p{L}/u.test(password)) {
    passwordErrors.push("Include at least one letter.");
  }
  if (!/\p{N}/u.test(password)) {
    passwordErrors.push("Include at least one digit.");
  }
  const normalizedEmail = normalizeEmail(email);
  const at = normalizedEmail.indexOf("@");
  const localPart = at > 0 ? normalizedEmail.slice(0, at) : "";
  if (localPart && password.toLowerCase().includes(localPart)) {
    passwordErrors.push("Password must not contain your email name.");
  }
  return passwordErrors;
}

export function validateCredentials(
  email: string,
  password: string,
  mode: "login" | "register" = "register",
): FieldErrors {
  const errors: FieldErrors = {};
  const emailErrors = validateEmail(email);
  if (emailErrors.length > 0) {
    errors.email = emailErrors;
  }

  if (mode === "login") {
    if (password.length === 0) {
      errors.password = ["Enter a password."];
    }
  } else {
    const passwordErrors = validatePassword(password, email);
    if (passwordErrors.length > 0) {
      errors.password = passwordErrors;
    }
  }

  return errors;
}
