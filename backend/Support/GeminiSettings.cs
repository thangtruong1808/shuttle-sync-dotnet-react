namespace ShuttleSync.Api.Support;

public sealed record GeminiSettings(string ApiKey, string Model)
{
    public bool IsConfigured => !string.IsNullOrWhiteSpace(ApiKey);

    public static GeminiSettings FromConfiguration(IConfiguration configuration)
    {
        var model = configuration["GEMINI_MODEL"]?.Trim();
        if (string.IsNullOrWhiteSpace(model) || !model.All(character => char.IsLetterOrDigit(character) || character is '.' or '-' or '_'))
        {
            model = "gemini-3.8-flash";
        }

        return new(configuration["GEMINI_API_KEY"]?.Trim() ?? "", model);
    }
}
