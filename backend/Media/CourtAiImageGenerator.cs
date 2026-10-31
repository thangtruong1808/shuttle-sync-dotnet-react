using System.Buffers.Binary;
using System.Globalization;
using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using ShuttleSync.Api.Data;
using ShuttleSync.Api.Support;

namespace ShuttleSync.Api.Media;

public sealed record CourtAiImageResult(
    string ImageUrl,
    string PublicId,
    string ImageHash,
    string Prompt);

public sealed class CourtAiImageGenerator(
    IHttpClientFactory httpClientFactory,
    GeminiSettings geminiSettings,
    CloudinaryImages cloudinaryImages)
{
    public const string CloudFolder = "court-ai";

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
    };

    public async Task<(CourtAiImageResult? Result, string? Error, int StatusCode)> GenerateAndUploadAsync(
        string venueName,
        DashCourtRow court,
        IReadOnlyList<DashCourtAiSignatureRow> existingCourts,
        CancellationToken cancellationToken)
    {
        if (!geminiSettings.IsConfigured)
        {
            return (null, "AI court image generation is not configured (missing GEMINI_API_KEY).", StatusCodes.Status503ServiceUnavailable);
        }

        var existingHashes = new HashSet<string>(
            existingCourts
                .Select(row => row.AiImageHash)
                .Where(hash => !string.IsNullOrWhiteSpace(hash))
                .Select(hash => hash!.Trim().ToLowerInvariant()),
            StringComparer.OrdinalIgnoreCase);

        var existingPrompts = existingCourts
            .Select(row => row.AiImagePrompt)
            .Where(prompt => !string.IsNullOrWhiteSpace(prompt))
            .Select(prompt => prompt!.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Take(25)
            .ToArray();

        var geminiOutcome = await AskGeminiForUniqueCourtDesignAsync(
            venueName,
            court,
            existingPrompts,
            cancellationToken);
        if (geminiOutcome.Error is not null)
        {
            return (null, geminiOutcome.Error, geminiOutcome.StatusCode);
        }

        byte[] imageBytes;
        string contentType;
        string promptSummary;

        if (geminiOutcome.InlineImageBytes is { Length: > 0 } rawBytes && !string.IsNullOrWhiteSpace(geminiOutcome.InlineMimeType))
        {
            imageBytes = rawBytes;
            contentType = geminiOutcome.InlineMimeType!;
            promptSummary = geminiOutcome.PromptSummary;
        }
        else
        {
            var spec = EnsureUniqueSpec(geminiOutcome.Spec!, court, existingPrompts);
            promptSummary = BuildPromptSummary(spec, venueName, court);
            imageBytes = RenderCourtPng(spec, court, attemptSeed: 0);
            contentType = "image/png";
        }

        var imageHash = ComputeSha256Hex(imageBytes);
        var attempt = 1;
        while (existingHashes.Contains(imageHash) && attempt <= 8)
        {
            var fallbackSpec = EnsureUniqueSpec(
                geminiOutcome.Spec ?? DefaultSpecForCourt(court, attempt),
                court,
                existingPrompts,
                attempt);
            promptSummary = $"{BuildPromptSummary(fallbackSpec, venueName, court)} [v{attempt}]";
            imageBytes = RenderCourtPng(fallbackSpec, court, attemptSeed: attempt * 7919);
            contentType = "image/png";
            imageHash = ComputeSha256Hex(imageBytes);
            attempt++;
        }

        var publicId = $"court-{court.Id:N}-{imageHash[..12]}";
        string imageUrl;
        try
        {
            await using var stream = new MemoryStream(imageBytes, writable: false);
            imageUrl = await cloudinaryImages.UploadAsync(
                stream,
                contentType,
                CloudFolder,
                publicId,
                cancellationToken);
        }
        catch (Exception exception) when (exception is InvalidOperationException or HttpRequestException)
        {
            return (null, "The generated AI court photo could not be uploaded to Cloudinary. Check Cloudinary settings and try again.", StatusCodes.Status502BadGateway);
        }

        return (new CourtAiImageResult(imageUrl, publicId, imageHash, promptSummary), null, StatusCodes.Status200OK);
    }

    private async Task<(CourtVisualSpec? Spec, byte[]? InlineImageBytes, string? InlineMimeType, string PromptSummary, string? Error, int StatusCode)> AskGeminiForUniqueCourtDesignAsync(
        string venueName,
        DashCourtRow court,
        string[] existingPrompts,
        CancellationToken cancellationToken)
    {
        var avoidBlock = existingPrompts.Length == 0
            ? "None yet."
            : string.Join("\n- ", existingPrompts);

        var variationNonce = Guid.NewGuid().ToString("N")[..8];
        var instruction = $"""
            You are an architectural sports arena designer generating a unique visual design specification for a badminton court photo.
            Every court MUST look visually distinct from all other courts (different mat color palette, arena wall architecture, lighting style, and camera perspective).

            Venue: {venueName}
            Court Name: {court.CourtName}
            Court Number: {court.CourtNumber}
            Surface Type: {court.SurfaceType ?? "Pro synthetic PVC mat"}
            Description: {court.Description ?? "Indoor tournament badminton court"}
            Unique Seed Token: {variationNonce}

            Existing court designs already used (DO NOT repeat these themes, color combinations, or perspectives):
            - {avoidBlock}

            Return ONLY a valid JSON object (no markdown fences, no extra prose) with these exact fields:
            - "themeTitle": short distinctive 3-6 word title for this court's look
            - "matPrimaryHex": 6-digit hex color (e.g. "#0E7C61", "#1B4F9C", "#7A2E8E", "#B84A27", "#0F6E8C", "#2D6A4F", "#8E244D", "#3B429F") for the outer court mat
            - "matInnerHex": 6-digit hex color for the inner play area (slightly brighter or complementary tone)
            - "floorOuterHex": 6-digit hex color for the surrounding hall floor (warm maple wood, dark walnut, slate, charcoal, birch, etc.)
            - "wallTopHex": 6-digit hex color for the upper arena ceiling/wall
            - "wallBottomHex": 6-digit hex color for the lower arena wall
            - "accentHex": 6-digit hex color for LED architectural trim & net badge
            - "lineHex": "#FFFFFF" or "#FFF8E7" or "#FFE680" for court boundary lines
            - "lightingStyle": one of ["spotlight", "skylight", "arena-beams", "perimeter-glow"]
            - "cameraAngle": one of ["elevated-center", "corner-left", "corner-right", "low-pro"]
            - "wallPattern": one of ["acoustic-slats", "geometric-panels", "panoramic-glass", "stadium-tiers"]
            """;

        var requestBody = new
        {
            contents = new object[]
            {
                new
                {
                    role = "user",
                    parts = new object[] { new { text = instruction } },
                },
            },
            generationConfig = new
            {
                temperature = 0.85,
                maxOutputTokens = 450,
            },
        };

        var client = httpClientFactory.CreateClient("gemini");
        var url = $"https://generativelanguage.googleapis.com/v1beta/models/{Uri.EscapeDataString(geminiSettings.Model)}:generateContent";
        using var request = new HttpRequestMessage(HttpMethod.Post, url);
        request.Headers.Add("x-goog-api-key", geminiSettings.ApiKey);
        request.Content = new StringContent(JsonSerializer.Serialize(requestBody), Encoding.UTF8, "application/json");

        string responsePayload;
        try
        {
            using var response = await client.SendAsync(request, cancellationToken);
            responsePayload = await response.Content.ReadAsStringAsync(cancellationToken);
            if (!response.IsSuccessStatusCode)
            {
                return (null, null, null, "", "Gemini could not generate the court image right now. Please try again in a moment.", StatusCodes.Status502BadGateway);
            }
        }
        catch (Exception exception) when (exception is HttpRequestException or TaskCanceledException)
        {
            return (null, null, null, "", "Gemini could not be reached right now. Please try again in a moment.", StatusCodes.Status502BadGateway);
        }

        if (TryExtractInlineImage(responsePayload, out var inlineBytes, out var inlineMime))
        {
            return (null, inlineBytes, inlineMime, $"Gemini inline image for {court.CourtName} (#{court.CourtNumber}) [{variationNonce}]", null, StatusCodes.Status200OK);
        }

        var textReply = ExtractTextReply(responsePayload);
        var spec = ParseSpecOrDefault(textReply, court);
        return (spec, null, null, BuildPromptSummary(spec, venueName, court), null, StatusCodes.Status200OK);
    }

    private static bool TryExtractInlineImage(string payload, out byte[]? bytes, out string? mimeType)
    {
        bytes = null;
        mimeType = null;
        try
        {
            using var document = JsonDocument.Parse(payload);
            if (!document.RootElement.TryGetProperty("candidates", out var candidates))
            {
                return false;
            }

            foreach (var candidate in candidates.EnumerateArray())
            {
                if (!candidate.TryGetProperty("content", out var content)
                    || !content.TryGetProperty("parts", out var parts))
                {
                    continue;
                }

                foreach (var part in parts.EnumerateArray())
                {
                    if (!part.TryGetProperty("inlineData", out var inlineData))
                    {
                        continue;
                    }

                    var mime = inlineData.TryGetProperty("mimeType", out var m) ? m.GetString() : null;
                    var data = inlineData.TryGetProperty("data", out var d) ? d.GetString() : null;
                    if (!string.IsNullOrWhiteSpace(mime)
                        && !string.IsNullOrWhiteSpace(data)
                        && mime is "image/png" or "image/jpeg" or "image/webp")
                    {
                        bytes = Convert.FromBase64String(data);
                        mimeType = mime;
                        return true;
                    }
                }
            }
        }
        catch (Exception)
        {
            return false;
        }

        return false;
    }

    private static string? ExtractTextReply(string payload)
    {
        try
        {
            using var document = JsonDocument.Parse(payload);
            if (!document.RootElement.TryGetProperty("candidates", out var candidates))
            {
                return null;
            }

            foreach (var candidate in candidates.EnumerateArray())
            {
                if (!candidate.TryGetProperty("content", out var content)
                    || !content.TryGetProperty("parts", out var parts))
                {
                    continue;
                }

                foreach (var part in parts.EnumerateArray())
                {
                    if (part.TryGetProperty("text", out var text) && text.GetString() is { Length: > 0 } value)
                    {
                        return value.Trim();
                    }
                }
            }
        }
        catch (JsonException)
        {
            return null;
        }

        return null;
    }

    private static CourtVisualSpec ParseSpecOrDefault(string? rawText, DashCourtRow court)
    {
        if (!string.IsNullOrWhiteSpace(rawText))
        {
            var start = rawText.IndexOf('{');
            var end = rawText.LastIndexOf('}');
            if (start >= 0 && end > start)
            {
                var jsonSlice = rawText[start..(end + 1)];
                try
                {
                    var parsed = JsonSerializer.Deserialize<CourtVisualSpec>(jsonSlice, JsonOptions);
                    if (parsed is not null && !string.IsNullOrWhiteSpace(parsed.ThemeTitle))
                    {
                        return parsed;
                    }
                }
                catch (JsonException)
                {
                    // Fall back to deterministic unique spec below.
                }
            }
        }

        return DefaultSpecForCourt(court, extraSalt: RandomNumberGenerator.GetInt32(1, 10000));
    }

    private static CourtVisualSpec EnsureUniqueSpec(
        CourtVisualSpec spec,
        DashCourtRow court,
        string[] existingPrompts,
        int extraAttempt = 0)
    {
        var summary = $"{spec.ThemeTitle}|{spec.MatPrimaryHex}|{spec.MatInnerHex}|{spec.CameraAngle}|{spec.LightingStyle}";
        var collides = existingPrompts.Any(p =>
            p.Contains(spec.MatPrimaryHex ?? "", StringComparison.OrdinalIgnoreCase)
            && p.Contains(spec.CameraAngle ?? "", StringComparison.OrdinalIgnoreCase));

        if (!collides && extraAttempt == 0)
        {
            return spec;
        }

        var fallback = DefaultSpecForCourt(court, extraAttempt + existingPrompts.Length + 1);
        return spec with
        {
            ThemeTitle = $"{spec.ThemeTitle} #{court.CourtNumber}-{extraAttempt + 1}",
            MatPrimaryHex = fallback.MatPrimaryHex,
            MatInnerHex = fallback.MatInnerHex,
            AccentHex = fallback.AccentHex,
            CameraAngle = fallback.CameraAngle,
            LightingStyle = fallback.LightingStyle,
            WallPattern = fallback.WallPattern,
        };
    }

    private static CourtVisualSpec DefaultSpecForCourt(DashCourtRow court, int extraSalt)
    {
        (string Title, string MatOut, string MatIn, string Floor, string WallTop, string WallBot, string Accent)[] palettes =
        [
            ("Emerald BWF Championship", "#0D6E52", "#148F6B", "#7A5230", "#0F172A", "#1E293B", "#34D399"),
            ("Royal Cobalt Arena", "#1D4ED8", "#2563EB", "#855834", "#111827", "#1E3A5F", "#60A5FA"),
            ("Sunset Terracotta Hall", "#9A3412", "#C2410C", "#27272A", "#18181B", "#3F2318", "#FB923C"),
            ("Amethyst Pro Pavilion", "#5B21B6", "#6D28D9", "#6B4F35", "#090D16", "#231942", "#C084FC"),
            ("Oceanic Teal Stadium", "#0F766E", "#0D9488", "#5C4028", "#0C1924", "#163244", "#2DD4BF"),
            ("Crimson Grand Court", "#9F1239", "#BE123C", "#785338", "#14141F", "#2D1622", "#FB7185"),
            ("Nordic Slate & Gold", "#334155", "#475569", "#8C6239", "#0B1120", "#1E293B", "#FBBF24"),
            ("Forest Jade & Birch", "#166534", "#15803D", "#A17449", "#101E17", "#1C3528", "#4ADE80"),
        ];

        string[] angles = ["elevated-center", "corner-left", "corner-right", "low-pro"];
        string[] lights = ["spotlight", "skylight", "arena-beams", "perimeter-glow"];
        string[] walls = ["acoustic-slats", "geometric-panels", "panoramic-glass", "stadium-tiers"];

        var hashBytes = SHA256.HashData(Encoding.UTF8.GetBytes($"{court.Id}:{court.CourtNumber}:{court.CourtName}:{extraSalt}"));
        var idx = BinaryPrimitives.ReadUInt16LittleEndian(hashBytes.AsSpan(0, 2));
        var palette = palettes[(idx + court.CourtNumber) % palettes.Length];
        return new CourtVisualSpec(
            ThemeTitle: palette.Title,
            MatPrimaryHex: palette.MatOut,
            MatInnerHex: palette.MatIn,
            FloorOuterHex: palette.Floor,
            WallTopHex: palette.WallTop,
            WallBottomHex: palette.WallBot,
            AccentHex: palette.Accent,
            LineHex: "#FFFFFF",
            LightingStyle: lights[(idx >> 3) % lights.Length],
            CameraAngle: angles[(idx >> 5) % angles.Length],
            WallPattern: walls[(idx >> 7) % walls.Length]);
    }

    private static string BuildPromptSummary(CourtVisualSpec spec, string venueName, DashCourtRow court) =>
        $"{spec.ThemeTitle} | {venueName} - {court.CourtName} (#{court.CourtNumber}) | mat:{spec.MatPrimaryHex}/{spec.MatInnerHex} | floor:{spec.FloorOuterHex} | wall:{spec.WallPattern} | light:{spec.LightingStyle} | angle:{spec.CameraAngle}";

    private static byte[] RenderCourtPng(CourtVisualSpec spec, DashCourtRow court, int attemptSeed)
    {
        const int width = 960;
        const int height = 600;
        const int horizonY = 215;

        var wallTop = ParseColor(spec.WallTopHex, (15, 23, 42));
        var wallBottom = ParseColor(spec.WallBottomHex, (30, 41, 59));
        var floorOuter = ParseColor(spec.FloorOuterHex, (122, 82, 48));
        var matPrimary = ParseColor(spec.MatPrimaryHex, (13, 110, 82));
        var matInner = ParseColor(spec.MatInnerHex, (20, 143, 107));
        var accent = ParseColor(spec.AccentHex, (52, 211, 153));
        var line = ParseColor(spec.LineHex, (255, 255, 255));

        var cameraShift = (spec.CameraAngle ?? "").ToLowerInvariant() switch
        {
            "corner-left" => -0.18f,
            "corner-right" => 0.18f,
            "low-pro" => 0.05f,
            _ => 0.0f,
        };

        var seedBytes = SHA256.HashData(Encoding.UTF8.GetBytes($"{court.Id}:{court.CourtNumber}:{spec.ThemeTitle}:{attemptSeed}"));
        var angleOffset = ((seedBytes[0] / 255f) - 0.5f) * 0.08f + cameraShift;

        var pixels = new byte[width * height * 3];

        for (var y = 0; y < height; y++)
        {
            if (y < horizonY)
            {
                var wt = y / (float)horizonY;
                var baseWall = LerpColor(wallTop, wallBottom, wt);
                for (var x = 0; x < width; x++)
                {
                    var c = ApplyWallPattern(baseWall, accent, x, y, width, horizonY, spec.WallPattern, spec.LightingStyle, seedBytes[1]);
                    SetPixel(pixels, width, x, y, c);
                }
            }
            else
            {
                var ft = (y - horizonY) / (float)(height - horizonY);
                var z = 1.0f / (0.18f + ft * 0.92f);
                var plankShade = MathF.Sin((z * 18f) + seedBytes[2] * 0.1f) * 0.035f;

                for (var x = 0; x < width; x++)
                {
                    var screenX = (x - width * 0.5f) / (width * 0.5f);
                    var u = (screenX - angleOffset * (1.0f - ft)) / (0.30f + ft * 0.85f);
                    var v = (ft - 0.06f) / 0.86f;

                    var c = FloorPixelColor(u, v, floorOuter, matPrimary, matInner, line, accent, plankShade);
                    SetPixel(pixels, width, x, y, c);
                }
            }
        }

        DrawNetAndPosts(pixels, width, height, horizonY, angleOffset, accent, line);
        DrawCourtBadge(pixels, width, height, court.CourtNumber, matPrimary, accent, line, seedBytes[3]);

        return EncodeRgbPng(pixels, width, height);
    }

    private static (byte R, byte G, byte B) ApplyWallPattern(
        (byte R, byte G, byte B) baseWall,
        (byte R, byte G, byte B) accent,
        int x,
        int y,
        int width,
        int horizonY,
        string? wallPattern,
        string? lightingStyle,
        byte seed)
    {
        var c = baseWall;
        var pat = (wallPattern ?? "").ToLowerInvariant();
        if (pat == "acoustic-slats")
        {
            if ((x + seed) % 18 < 3 && y > 35 && y < horizonY - 12)
            {
                c = LerpColor(c, (byte.MaxValue, byte.MaxValue, byte.MaxValue), 0.07f);
            }
        }
        else if (pat == "geometric-panels")
        {
            if (((x + y + seed) % 64 == 0 || (x - y + 512) % 64 == 0) && y > 25)
            {
                c = LerpColor(c, accent, 0.18f);
            }
        }
        else if (pat == "panoramic-glass")
        {
            if (y is > 45 and < 155 && x is > 90 and < 870)
            {
                c = LerpColor(c, accent, 0.14f);
                if (x % 110 < 3 || y is 47 or 153)
                {
                    c = LerpColor(c, (220, 230, 242), 0.35f);
                }
            }
        }
        else
        {
            if (y % 28 < 2 && y > 40)
            {
                c = LerpColor(c, accent, 0.15f);
            }
        }

        if (y >= horizonY - 5)
        {
            c = LerpColor(c, accent, 0.65f);
        }

        var light = (lightingStyle ?? "").ToLowerInvariant();
        var beamCount = light == "skylight" ? 3 : 5;
        for (var i = 1; i <= beamCount; i++)
        {
            var bx = width * i / (float)(beamCount + 1);
            var spread = 22f + y * 0.55f;
            var dist = MathF.Abs(x - bx);
            if (dist < spread)
            {
                var intensity = (1.0f - dist / spread) * (1.0f - (y / (float)horizonY) * 0.55f) * 0.28f;
                c = LerpColor(c, (255, 252, 240), intensity);
            }
        }

        return c;
    }

    private static (byte R, byte G, byte B) FloorPixelColor(
        float u,
        float v,
        (byte R, byte G, byte B) floorOuter,
        (byte R, byte G, byte B) matPrimary,
        (byte R, byte G, byte B) matInner,
        (byte R, byte G, byte B) line,
        (byte R, byte G, byte B) accent,
        float plankShade)
    {
        var absU = MathF.Abs(u);
        if (v < 0f || v > 1.0f || absU > 0.86f)
        {
            var c = Shade(floorOuter, plankShade);
            if (v is >= -0.02f and <= 1.02f && absU <= 0.88f)
            {
                c = LerpColor(c, (10, 15, 25), 0.25f);
            }

            return c;
        }

        if (absU > 0.72f || v < 0.06f || v > 0.94f)
        {
            return Shade(matPrimary, plankShade * 0.3f);
        }

        var courtU = absU / 0.72f;
        var courtV = (v - 0.06f) / 0.88f;
        var distNet = MathF.Abs(courtV - 0.5f);

        const float lw = 0.013f;
        var isLine =
            MathF.Abs(courtU - 1.0f) < lw
            || MathF.Abs(courtU - 0.84f) < lw
            || MathF.Abs(courtV - 0.0f) < lw
            || MathF.Abs(courtV - 1.0f) < lw
            || MathF.Abs(courtV - 0.065f) < lw
            || MathF.Abs(courtV - 0.935f) < lw
            || MathF.Abs(distNet - 0.15f) < lw
            || (courtU < lw * 0.9f && distNet >= 0.15f);

        if (isLine)
        {
            return line;
        }

        var inner = distNet < 0.15f
            ? LerpColor(matInner, accent, 0.10f)
            : matInner;

        return Shade(inner, (0.5f - distNet) * 0.06f);
    }

    private static void DrawNetAndPosts(
        byte[] pixels,
        int width,
        int height,
        int horizonY,
        float angleOffset,
        (byte R, byte G, byte B) accent,
        (byte R, byte G, byte B) line)
    {
        const float netFt = 0.06f + 0.5f * 0.86f;
        var netBaseY = horizonY + (int)(netFt * (height - horizonY));
        var netHeight = 46;
        var netTopY = netBaseY - netHeight;

        var scale = 0.30f + netFt * 0.85f;
        var shift = angleOffset * (1.0f - netFt);
        var leftX = (int)(((-0.74f * scale + shift) * 0.5f + 0.5f) * width);
        var rightX = (int)(((0.74f * scale + shift) * 0.5f + 0.5f) * width);

        leftX = Math.Clamp(leftX, 20, width - 20);
        rightX = Math.Clamp(rightX, leftX + 40, width - 20);

        for (var y = netTopY; y <= netBaseY; y++)
        {
            if (y < 0 || y >= height) continue;
            for (var x = leftX; x <= rightX; x++)
            {
                if (x <= leftX + 5 || x >= rightX - 5)
                {
                    SetPixel(pixels, width, x, y, accent);
                }
                else if (y <= netTopY + 5)
                {
                    SetPixel(pixels, width, x, y, line);
                }
                else if ((x + y) % 4 == 0 || (x - y + 1024) % 4 == 0)
                {
                    var existing = GetPixel(pixels, width, x, y);
                    SetPixel(pixels, width, x, y, LerpColor(existing, (230, 238, 245), 0.42f));
                }
            }
        }
    }

    private static void DrawCourtBadge(
        byte[] pixels,
        int width,
        int height,
        int courtNumber,
        (byte R, byte G, byte B) matPrimary,
        (byte R, byte G, byte B) accent,
        (byte R, byte G, byte B) line,
        byte badgeSeed)
    {
        var badgeX = 48 + (badgeSeed % 24);
        var badgeY = 38;
        const int bw = 128;
        const int bh = 54;

        for (var y = badgeY; y < badgeY + bh && y < height; y++)
        {
            for (var x = badgeX; x < badgeX + bw && x < width; x++)
            {
                var border = x < badgeX + 3 || x >= badgeX + bw - 3 || y < badgeY + 3 || y >= badgeY + bh - 3;
                SetPixel(pixels, width, x, y, border ? accent : matPrimary);
            }
        }

        var label = $"#{Math.Clamp(courtNumber, 1, 99)}";
        DrawText5x7(pixels, width, height, badgeX + 20, badgeY + 13, label, line, scale: 4);
    }

    private static void DrawText5x7(
        byte[] pixels,
        int width,
        int height,
        int startX,
        int startY,
        string text,
        (byte R, byte G, byte B) color,
        int scale)
    {
        var cursorX = startX;
        foreach (var ch in text)
        {
            var glyph = Glyph5x7(ch);
            for (var row = 0; row < 7; row++)
            {
                var bits = glyph[row];
                for (var col = 0; col < 5; col++)
                {
                    if (((bits >> (4 - col)) & 1) == 0) continue;
                    for (var sy = 0; sy < scale; sy++)
                    {
                        for (var sx = 0; sx < scale; sx++)
                        {
                            var px = cursorX + col * scale + sx;
                            var py = startY + row * scale + sy;
                            if (px >= 0 && px < width && py >= 0 && py < height)
                            {
                                SetPixel(pixels, width, px, py, color);
                            }
                        }
                    }
                }
            }

            cursorX += 6 * scale;
        }
    }

    private static byte[] Glyph5x7(char c) => c switch
    {
        '#' => [0b01010, 0b11111, 0b01010, 0b01010, 0b11111, 0b01010, 0b00000],
        '0' => [0b01110, 0b10001, 0b10011, 0b10101, 0b11001, 0b10001, 0b01110],
        '1' => [0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
        '2' => [0b01110, 0b10001, 0b00001, 0b00110, 0b01000, 0b10000, 0b11111],
        '3' => [0b11110, 0b00001, 0b00001, 0b01110, 0b00001, 0b00001, 0b11110],
        '4' => [0b00010, 0b00110, 0b01010, 0b10010, 0b11111, 0b00010, 0b00010],
        '5' => [0b11111, 0b10000, 0b11110, 0b00001, 0b00001, 0b10001, 0b01110],
        '6' => [0b01110, 0b10000, 0b11110, 0b10001, 0b10001, 0b10001, 0b01110],
        '7' => [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b01000, 0b01000],
        '8' => [0b01110, 0b10001, 0b10001, 0b01110, 0b10001, 0b10001, 0b01110],
        '9' => [0b01110, 0b10001, 0b10001, 0b01111, 0b00001, 0b00001, 0b01110],
        _ => [0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b00000],
    };

    private static void SetPixel(byte[] pixels, int width, int x, int y, (byte R, byte G, byte B) color)
    {
        var idx = (y * width + x) * 3;
        pixels[idx] = color.R;
        pixels[idx + 1] = color.G;
        pixels[idx + 2] = color.B;
    }

    private static (byte R, byte G, byte B) GetPixel(byte[] pixels, int width, int x, int y)
    {
        var idx = (y * width + x) * 3;
        return (pixels[idx], pixels[idx + 1], pixels[idx + 2]);
    }

    private static (byte R, byte G, byte B) LerpColor((byte R, byte G, byte B) a, (byte R, byte G, byte B) b, float t)
    {
        var clamped = Math.Clamp(t, 0f, 1f);
        return (
            (byte)(a.R + (b.R - a.R) * clamped),
            (byte)(a.G + (b.G - a.G) * clamped),
            (byte)(a.B + (b.B - a.B) * clamped));
    }

    private static (byte R, byte G, byte B) Shade((byte R, byte G, byte B) c, float delta) => (
        (byte)Math.Clamp((int)(c.R * (1f + delta)), 0, 255),
        (byte)Math.Clamp((int)(c.G * (1f + delta)), 0, 255),
        (byte)Math.Clamp((int)(c.B * (1f + delta)), 0, 255));

    private static (byte R, byte G, byte B) ParseColor(string? hex, (byte R, byte G, byte B) fallback)
    {
        if (string.IsNullOrWhiteSpace(hex)) return fallback;
        var clean = hex.Trim().TrimStart('#');
        if (clean.Length == 6
            && byte.TryParse(clean[..2], NumberStyles.HexNumber, CultureInfo.InvariantCulture, out var r)
            && byte.TryParse(clean[2..4], NumberStyles.HexNumber, CultureInfo.InvariantCulture, out var g)
            && byte.TryParse(clean[4..6], NumberStyles.HexNumber, CultureInfo.InvariantCulture, out var b))
        {
            return (r, g, b);
        }

        return fallback;
    }

    private static byte[] EncodeRgbPng(byte[] rgb, int width, int height)
    {
        using var output = new MemoryStream();
        output.Write([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

        Span<byte> ihdr = stackalloc byte[13];
        BinaryPrimitives.WriteUInt32BigEndian(ihdr[..4], (uint)width);
        BinaryPrimitives.WriteUInt32BigEndian(ihdr[4..8], (uint)height);
        ihdr[8] = 8;  // bit depth
        ihdr[9] = 2;  // color type: truecolor RGB
        ihdr[10] = 0; // compression
        ihdr[11] = 0; // filter
        ihdr[12] = 0; // interlace
        WritePngChunk(output, "IHDR"u8, ihdr);

        using var compressed = new MemoryStream();
        using (var zlib = new ZLibStream(compressed, CompressionLevel.Fastest, leaveOpen: true))
        {
            var rowStride = width * 3;
            for (var y = 0; y < height; y++)
            {
                zlib.WriteByte(0); // filter type 0 (None)
                zlib.Write(rgb, y * rowStride, rowStride);
            }
        }

        WritePngChunk(output, "IDAT"u8, compressed.ToArray());
        WritePngChunk(output, "IEND"u8, []);
        return output.ToArray();
    }

    private static void WritePngChunk(Stream stream, ReadOnlySpan<byte> type, ReadOnlySpan<byte> data)
    {
        Span<byte> lengthBytes = stackalloc byte[4];
        BinaryPrimitives.WriteUInt32BigEndian(lengthBytes, (uint)data.Length);
        stream.Write(lengthBytes);
        stream.Write(type);
        if (!data.IsEmpty)
        {
            stream.Write(data);
        }

        var crc = ComputeCrc32(type, data);
        Span<byte> crcBytes = stackalloc byte[4];
        BinaryPrimitives.WriteUInt32BigEndian(crcBytes, crc);
        stream.Write(crcBytes);
    }

    private static uint ComputeCrc32(ReadOnlySpan<byte> type, ReadOnlySpan<byte> data)
    {
        uint crc = 0xFFFFFFFFu;
        foreach (var b in type)
        {
            crc = UpdateCrcByte(crc, b);
        }

        foreach (var b in data)
        {
            crc = UpdateCrcByte(crc, b);
        }

        return ~crc;
    }

    private static uint UpdateCrcByte(uint crc, byte b)
    {
        crc ^= b;
        for (var i = 0; i < 8; i++)
        {
            crc = (crc & 1) != 0 ? (crc >> 1) ^ 0xEDB88320u : crc >> 1;
        }

        return crc;
    }

    private static string ComputeSha256Hex(byte[] data) =>
        Convert.ToHexStringLower(SHA256.HashData(data));

    private sealed record CourtVisualSpec(
        string ThemeTitle,
        string? MatPrimaryHex,
        string? MatInnerHex,
        string? FloorOuterHex,
        string? WallTopHex,
        string? WallBottomHex,
        string? AccentHex,
        string? LineHex,
        string? LightingStyle,
        string? CameraAngle,
        string? WallPattern);
}

