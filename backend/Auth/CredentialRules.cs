using System.Text.RegularExpressions;

namespace ShuttleSync.Api.Auth;

public static partial class CredentialRules
{
    public const int EmailMaxLength = 256;
    public const int PasswordMinLength = 12;
    public const int PasswordMaxLength = 128;

    public static string NormalizeEmail(string? email) => (email ?? "").Trim().ToLowerInvariant();

    public static Dictionary<string, string[]> Validate(string? email, string? password)
    {
        var errors = new Dictionary<string, List<string>>();
        var normalizedEmail = NormalizeEmail(email);
        var rawPassword = password ?? "";

        if (normalizedEmail.Length == 0)
        {
            Add(errors, "email", "Enter an email address.");
        }
        else if (normalizedEmail.Length > EmailMaxLength)
        {
            Add(errors, "email", "Email must be 256 characters or fewer.");
        }
        else if (!EmailPattern().IsMatch(normalizedEmail))
        {
            Add(errors, "email", "Enter a valid email address.");
        }

        if (rawPassword.Length == 0)
        {
            Add(errors, "password", "Enter a password.");
        }
        else if (rawPassword.Length < PasswordMinLength)
        {
            Add(errors, "password", "Use at least 12 characters.");
        }
        else if (rawPassword.Length > PasswordMaxLength)
        {
            Add(errors, "password", "Use at most 128 characters.");
        }
        else
        {
            if (!LetterPattern().IsMatch(rawPassword))
            {
                Add(errors, "password", "Include at least one letter.");
            }

            if (!NumberPattern().IsMatch(rawPassword))
            {
                Add(errors, "password", "Include at least one digit.");
            }

            var at = normalizedEmail.IndexOf('@');
            if (at > 0)
            {
                var localPart = normalizedEmail[..at];
                if (localPart.Length > 0
                    && rawPassword.Contains(localPart, StringComparison.OrdinalIgnoreCase))
                {
                    Add(errors, "password", "Password must not contain your email name.");
                }
            }
        }

        return errors.ToDictionary(pair => pair.Key, pair => pair.Value.ToArray());
    }

    private static void Add(Dictionary<string, List<string>> errors, string field, string message)
    {
        if (!errors.TryGetValue(field, out var messages))
        {
            messages = [];
            errors[field] = messages;
        }

        messages.Add(message);
    }

    [GeneratedRegex(@"^[^@\s]+@[^@\s]+\.[^@\s]+$")]
    private static partial Regex EmailPattern();

    [GeneratedRegex(@"\p{L}")]
    private static partial Regex LetterPattern();

    [GeneratedRegex(@"\p{N}")]
    private static partial Regex NumberPattern();
}
