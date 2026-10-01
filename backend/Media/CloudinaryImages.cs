using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace ShuttleSync.Api.Media;

public sealed record CloudinarySettings(string CloudName, string ApiKey, string ApiSecret)
{
    public bool IsConfigured =>
        !string.IsNullOrWhiteSpace(CloudName)
        && !string.IsNullOrWhiteSpace(ApiKey)
        && !string.IsNullOrWhiteSpace(ApiSecret);

    public static CloudinarySettings FromConfiguration(IConfiguration configuration) => new(
        Clean(configuration["CLOUDINARY_CLOUD_NAME"]),
        Clean(configuration["CLOUDINARY_API_KEY"]),
        Clean(configuration["CLOUDINARY_API_SECRET"]));

    private static string Clean(string? value) =>
        (value ?? "").Trim().Trim('"');
}

public sealed class CloudinaryImages(IHttpClientFactory httpClientFactory, CloudinarySettings settings)
{
    public async Task<string> UploadAsync(
        Stream content,
        string contentType,
        string folder,
        string publicId,
        CancellationToken cancellationToken)
    {
        if (!settings.IsConfigured)
        {
            throw new InvalidOperationException("Cloudinary is not configured.");
        }

        var timestamp = DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString();
        var cloudFolder = $"shuttle-sync/{folder}";
        var parameters = new SortedDictionary<string, string>
        {
            ["folder"] = cloudFolder,
            ["invalidate"] = "true",
            ["overwrite"] = "true",
            ["public_id"] = publicId,
            ["timestamp"] = timestamp,
        };
        var signature = Sign(parameters, settings.ApiSecret);

        using var body = new MultipartFormDataContent();
        var fileContent = new StreamContent(content);
        fileContent.Headers.ContentType = new MediaTypeHeaderValue(contentType);
        body.Add(fileContent, "file", publicId);
        body.Add(new StringContent(settings.ApiKey), "api_key");
        body.Add(new StringContent(signature), "signature");
        foreach (var parameter in parameters)
        {
            body.Add(new StringContent(parameter.Value), parameter.Key);
        }

        var client = httpClientFactory.CreateClient("cloudinary");
        var url = $"https://api.cloudinary.com/v1_1/{settings.CloudName}/image/upload";
        using var response = await client.PostAsync(url, body, cancellationToken);
        var payload = await response.Content.ReadAsStringAsync(cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            throw new InvalidOperationException("Cloudinary rejected the image.");
        }

        using var document = JsonDocument.Parse(payload);
        if (!document.RootElement.TryGetProperty("secure_url", out var secureUrl)
            || string.IsNullOrWhiteSpace(secureUrl.GetString()))
        {
            throw new InvalidOperationException("Cloudinary did not return an image URL.");
        }

        return secureUrl.GetString()!;
    }

    private static string Sign(SortedDictionary<string, string> parameters, string apiSecret)
    {
        var signed = string.Join("&", parameters.Select(pair => $"{pair.Key}={pair.Value}"));
        var hash = SHA1.HashData(Encoding.UTF8.GetBytes(signed + apiSecret));
        return Convert.ToHexString(hash).ToLowerInvariant();
    }
}
