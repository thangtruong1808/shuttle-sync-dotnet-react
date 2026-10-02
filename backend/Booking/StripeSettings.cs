namespace ShuttleSync.Api.Booking;

public sealed record StripeSettings(string SecretKey, string WebhookSecret)
{
    public bool IsConfigured => !string.IsNullOrWhiteSpace(SecretKey);

    public static StripeSettings FromConfiguration(IConfiguration configuration) =>
        new(configuration["STRIPE_SECRET_KEY"]?.Trim() ?? "", configuration["STRIPE_WEBHOOK_SECRET"]?.Trim() ?? "");
}
