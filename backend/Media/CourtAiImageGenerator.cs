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

        var geminiOutcome = await AskGeminiForUniqueArtworkDesignAsync(
            venueName,
            court,
            existingPrompts,
            cancellationToken);
        if (geminiOutcome.Error is not null)
        {
            return (null, geminiOutcome.Error, geminiOutcome.StatusCode);
        }

        var spec = EnsureUniqueSpec(geminiOutcome.Spec!, court, existingPrompts);
        var promptSummary = BuildPromptSummary(spec, venueName, court);
        var imageBytes = RenderBadmintonRacketAndShuttlePng(spec, court, attemptSeed: 0);
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
            imageBytes = RenderBadmintonRacketAndShuttlePng(fallbackSpec, court, attemptSeed: attempt * 7919);
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
                "image/png",
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

    private async Task<(CourtArtworkSpec? Spec, string? Error, int StatusCode)> AskGeminiForUniqueArtworkDesignAsync(
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
            You are the sports illustrator for "Shuttle Sync", a modern badminton booking platform.
            Design an energetic, entertaining badminton illustration featuring pro badminton rackets and a detailed 16-feather shuttlecock in action, styled with Shuttle Sync's frontend design tokens:

            Shuttle Sync Design Tokens:
            - Deep Botanical Forest Surfaces: "#07140F", "#0C1C16", "#0E1F17", "#10261C", "#142A20", "#163528"
            - Subtle Sage Grid / Border Lines: "#233A2F", "#2A4739"
            - Signature Electric Volt-Lime Accent: "#C6F54E"
            - Secondary Sport Accents: "#86EFAC" (mint), "#BEF264" (chartreuse), "#5EEAD4" (teal), "#FDE047" (warm gold), "#38BDF8" (sky spark), "#FB923C" (sunset energy)
            - Crisp Feather & String Highlights: "#F5F8F4", "#E7F6EE"
            - IMPORTANT: Every court MUST feature both badminton racket(s) and a realistic feathered shuttlecock with dynamic motion trails/sparks, NO indoor room walls/floors, and NO text or numbers (#1, #2).

            Venue: {venueName}
            Court Name: {court.CourtName}
            Unique Seed Token: {variationNonce}

            Existing court designs already used (DO NOT repeat these combinations):
            - {avoidBlock}

            Return ONLY a valid JSON object (no markdown fences, no extra prose) with these exact fields:
            - "themeTitle": short 3-5 word title for this badminton racket & shuttlecock action artwork
            - "bgStartHex": deep forest hex from ["#07140F", "#0A1B14", "#0C1C16", "#0E2219", "#10261C", "#091915"]
            - "bgEndHex": richer forest/teal hex from ["#142A20", "#163528", "#1B3F30", "#13332B", "#1A3829", "#1E3A2F"]
            - "glowHex": primary spotlight & smash-trail hex from ["#C6F54E", "#BEF264", "#A3E635", "#86EFAC", "#5EEAD4"]
            - "secondaryAccentHex": racket trim & cork ribbon hex from ["#5EEAD4", "#FDE047", "#38BDF8", "#FB923C", "#6EE7B7", "#A7F3D0"]
            - "featherHex": "#F5F8F4" or "#E7F6EE" or "#FEFCE8" for the shuttlecock goose feathers
            - "composition": one of ["smash-impact", "crossed-pro-rackets", "forehand-drive", "aerial-drop-shot"]
            - "backdropGrid": one of ["schedule-slots", "dot-matrix", "topographic-rings", "diagonal-mesh"]
            - "glowCorner": one of ["top-right", "top-left", "bottom-right", "center-crest"]
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
                return (null, "Gemini could not generate the court image right now. Please try again in a moment.", StatusCodes.Status502BadGateway);
            }
        }
        catch (Exception exception) when (exception is HttpRequestException or TaskCanceledException)
        {
            return (null, "Gemini could not be reached right now. Please try again in a moment.", StatusCodes.Status502BadGateway);
        }

        var textReply = ExtractTextReply(responsePayload);
        var spec = ParseSpecOrDefault(textReply, court);
        return (spec, null, StatusCodes.Status200OK);
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

    private static CourtArtworkSpec ParseSpecOrDefault(string? rawText, DashCourtRow court)
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
                    var parsed = JsonSerializer.Deserialize<CourtArtworkSpec>(jsonSlice, JsonOptions);
                    if (parsed is not null && !string.IsNullOrWhiteSpace(parsed.ThemeTitle))
                    {
                        return parsed;
                    }
                }
                catch (JsonException)
                {
                    // Fall back to deterministic Shuttle Sync spec below.
                }
            }
        }

        return DefaultSpecForCourt(court, extraSalt: RandomNumberGenerator.GetInt32(1, 10000));
    }

    private static CourtArtworkSpec EnsureUniqueSpec(
        CourtArtworkSpec spec,
        DashCourtRow court,
        string[] existingPrompts,
        int extraAttempt = 0)
    {
        var collides = existingPrompts.Any(p =>
            p.Contains(spec.Composition ?? "", StringComparison.OrdinalIgnoreCase)
            && p.Contains(spec.BackdropGrid ?? "", StringComparison.OrdinalIgnoreCase)
            && p.Contains(spec.SecondaryAccentHex ?? "", StringComparison.OrdinalIgnoreCase));

        if (!collides && extraAttempt == 0)
        {
            return spec;
        }

        var fallback = DefaultSpecForCourt(court, extraAttempt + existingPrompts.Length + 1);
        return spec with
        {
            ThemeTitle = $"{spec.ThemeTitle} · {fallback.Composition}",
            BgStartHex = fallback.BgStartHex,
            BgEndHex = fallback.BgEndHex,
            GlowHex = fallback.GlowHex,
            SecondaryAccentHex = fallback.SecondaryAccentHex,
            FeatherHex = fallback.FeatherHex,
            Composition = fallback.Composition,
            BackdropGrid = fallback.BackdropGrid,
            GlowCorner = fallback.GlowCorner,
        };
    }

    private static CourtArtworkSpec DefaultSpecForCourt(DashCourtRow court, int extraSalt)
    {
        (string Title, string BgStart, string BgEnd, string Glow, string Secondary, string Feather)[] palettes =
        [
            ("Volt Smash Impact", "#07140F", "#163528", "#C6F54E", "#5EEAD4", "#F5F8F4"),
            ("Twin Racket Rally", "#0C1C16", "#142A20", "#BEF264", "#FDE047", "#E7F6EE"),
            ("Emerald Forehand Drive", "#0A1B14", "#1B3F30", "#86EFAC", "#38BDF8", "#F5F8F4"),
            ("Canopy Aerial Drop", "#10261C", "#07140F", "#C6F54E", "#FB923C", "#FEFCE8"),
            ("Mint & Volt Pro Clash", "#091915", "#13332B", "#5EEAD4", "#C6F54E", "#F5F8F4"),
            ("Chartreuse String Surge", "#0E1F17", "#1E3A2F", "#A3E635", "#6EE7B7", "#E7F6EE"),
            ("Botanical Power Clear", "#07140F", "#1A3829", "#C6F54E", "#FDE047", "#F5F8F4"),
            ("Sage Velocity Whip", "#0C1C16", "#163528", "#D9F99D", "#5EEAD4", "#E7F6EE"),
        ];

        string[] compositions = ["smash-impact", "crossed-pro-rackets", "forehand-drive", "aerial-drop-shot"];
        string[] grids = ["schedule-slots", "dot-matrix", "topographic-rings", "diagonal-mesh"];
        string[] corners = ["top-right", "top-left", "bottom-right", "center-crest"];

        var hashBytes = SHA256.HashData(Encoding.UTF8.GetBytes($"{court.Id}:{court.CourtNumber}:{court.CourtName}:{extraSalt}"));
        var idx = BinaryPrimitives.ReadUInt16LittleEndian(hashBytes.AsSpan(0, 2));
        var palette = palettes[(idx + court.CourtNumber) % palettes.Length];
        return new CourtArtworkSpec(
            ThemeTitle: palette.Title,
            BgStartHex: palette.BgStart,
            BgEndHex: palette.BgEnd,
            GlowHex: palette.Glow,
            SecondaryAccentHex: palette.Secondary,
            FeatherHex: palette.Feather,
            Composition: compositions[(idx >> 2) % compositions.Length],
            BackdropGrid: grids[(idx >> 4) % grids.Length],
            GlowCorner: corners[(idx >> 6) % corners.Length]);
    }

    private static string BuildPromptSummary(CourtArtworkSpec spec, string venueName, DashCourtRow court) =>
        $"{spec.ThemeTitle} | {venueName} - {court.CourtName} | tokens:{spec.BgStartHex}/{spec.GlowHex}/{spec.SecondaryAccentHex} | comp:{spec.Composition} | grid:{spec.BackdropGrid} | glow:{spec.GlowCorner}";

    private static byte[] RenderBadmintonRacketAndShuttlePng(CourtArtworkSpec spec, DashCourtRow court, int attemptSeed)
    {
        const int width = 960;
        const int height = 600;

        // Shuttle Sync CSS design tokens:
        var bgStart = ClampToBotanicalDark(ParseColor(spec.BgStartHex, (16, 38, 28)));
        var bgEnd = ClampToBotanicalDark(ParseColor(spec.BgEndHex, (22, 53, 40)));
        var voltAccent = (R: (byte)198, G: (byte)245, B: (byte)78); // #C6F54E (--accent)
        var glowColor = LerpColor(ParseColor(spec.GlowHex, voltAccent), voltAccent, 0.55f);
        var secondary = ParseColor(spec.SecondaryAccentHex, (94, 234, 212));
        var featherColor = ParseColor(spec.FeatherHex, (245, 248, 244));
        var borderToken = (R: (byte)35, G: (byte)58, B: (byte)47);   // #233A2F (--border)
        var surface2Token = (R: (byte)20, G: (byte)42, B: (byte)32); // #142A20 (--surface-2)
        var fgToken = (R: (byte)231, G: (byte)246, B: (byte)238);     // #E7F6EE (--fg)

        var seed = SHA256.HashData(Encoding.UTF8.GetBytes($"{court.Id}:{spec.ThemeTitle}:{spec.Composition}:{attemptSeed}"));
        var phase = (seed[0] / 255f) * MathF.PI * 2f;

        var (glowX, glowY) = (spec.GlowCorner ?? "").ToLowerInvariant() switch
        {
            "top-left" => (width * 0.18f, height * 0.18f),
            "bottom-right" => (width * 0.82f, height * 0.80f),
            "center-crest" => (width * 0.50f, height * 0.34f),
            _ => (width * 0.82f, height * 0.16f),
        };

        var secondaryOrbX = width * (0.20f + (seed[1] / 255f) * 0.58f);
        var secondaryOrbY = height * (0.60f + (seed[2] / 255f) * 0.26f);

        var pixels = new byte[width * height * 3];
        var gridMode = (spec.BackdropGrid ?? "").ToLowerInvariant();

        // 1. Shuttle Sync botanical dark gradient + radial volt spotlight + schedule/geometric grid
        for (var y = 0; y < height; y++)
        {
            var ny = y / (float)height;
            for (var x = 0; x < width; x++)
            {
                var nx = x / (float)width;
                var diagT = (nx * 0.55f) + (ny * 0.45f);
                var c = LerpColor(bgStart, bgEnd, diagT);

                var dxGlow = (x - glowX) / (width * 0.55f);
                var dyGlow = (y - glowY) / (height * 0.65f);
                var distGlow = MathF.Sqrt(dxGlow * dxGlow + dyGlow * dyGlow);
                if (distGlow < 1f)
                {
                    c = LerpColor(c, glowColor, (1f - distGlow) * (1f - distGlow) * 0.36f);
                }

                var dxSec = (x - secondaryOrbX) / (width * 0.44f);
                var dySec = (y - secondaryOrbY) / (height * 0.48f);
                var distSec = MathF.Sqrt(dxSec * dxSec + dySec * dySec);
                if (distSec < 1f)
                {
                    c = LerpColor(c, secondary, (1f - distSec) * (1f - distSec) * 0.20f);
                }

                if (gridMode == "schedule-slots")
                {
                    if (x % 80 == 0 || y % 60 == 0)
                    {
                        c = LerpColor(c, borderToken, 0.42f);
                    }
                }
                else if (gridMode == "dot-matrix")
                {
                    var gx = (x + 16) % 32 - 16;
                    var gy = (y + 16) % 32 - 16;
                    if (gx * gx + gy * gy <= 4)
                    {
                        c = LerpColor(c, glowColor, 0.16f);
                    }
                }
                else if (gridMode == "topographic-rings")
                {
                    var rDist = MathF.Sqrt((x - width * 0.5f) * (x - width * 0.5f) + (y - height * 0.5f) * (y - height * 0.5f));
                    if (MathF.Abs((rDist + seed[3]) % 56f - 28f) < 1.2f)
                    {
                        c = LerpColor(c, borderToken, 0.55f);
                    }
                }
                else
                {
                    if ((x + y + seed[4]) % 44 == 0 || (x - y + 1024) % 44 == 0)
                    {
                        c = LerpColor(c, borderToken, 0.38f);
                    }
                }

                SetPixel(pixels, width, x, y, c);
            }
        }

        // 2. Subtle Bento / Schedule pills in corners to connect with CourtCard & DayChart UI
        DrawSchedulePillsBackdrop(pixels, width, height, seed, surface2Token, borderToken, voltAccent, secondary);

        // 3. Draw entertaining Badminton Racket(s) + Detailed Feathered Shuttlecock + Smash Energy Trail!
        var comp = (spec.Composition ?? "").ToLowerInvariant();
        var mirror = (seed[5] & 1) == 1;

        if (comp == "crossed-pro-rackets")
        {
            DrawSwooshTrail(pixels, width, height, mirror, phase, voltAccent, secondary);
            // Two crossed pro badminton rackets + center shuttlecock
            DrawProBadmintonRacket(pixels, width, height, width * 0.43f, height * 0.43f, -0.62f, 1.05f, secondary, fgToken, voltAccent);
            DrawProBadmintonRacket(pixels, width, height, width * 0.57f, height * 0.43f, 0.62f, 1.05f, voltAccent, fgToken, secondary);
            DrawImpactBurst(pixels, width, height, width * 0.50f, height * 0.38f, 82f, voltAccent, secondary);
            DrawRealisticFeatheredShuttlecock(pixels, width, height, width * 0.50f, height * 0.36f, mirror ? -0.35f : 0.35f, 1.18f, featherColor, voltAccent, secondary);
        }
        else if (comp == "forehand-drive")
        {
            DrawSwooshTrail(pixels, width, height, !mirror, phase, secondary, voltAccent);
            var rx = mirror ? width * 0.64f : width * 0.36f;
            var sx = mirror ? width * 0.34f : width * 0.66f;
            DrawProBadmintonRacket(pixels, width, height, rx, height * 0.46f, mirror ? 0.52f : -0.52f, 1.15f, voltAccent, fgToken, secondary);
            DrawImpactBurst(pixels, width, height, width * 0.50f, height * 0.40f, 70f, voltAccent, secondary);
            DrawRealisticFeatheredShuttlecock(pixels, width, height, sx, height * 0.36f, mirror ? 0.85f : -0.85f, 1.25f, featherColor, secondary, voltAccent);
        }
        else if (comp == "aerial-drop-shot")
        {
            DrawSwooshTrail(pixels, width, height, mirror, phase, voltAccent, fgToken);
            DrawProBadmintonRacket(pixels, width, height, width * 0.38f, height * 0.50f, -0.78f, 1.10f, secondary, fgToken, voltAccent);
            DrawRealisticFeatheredShuttlecock(pixels, width, height, width * 0.62f, height * 0.30f, -0.65f, 1.22f, featherColor, voltAccent, secondary);
            DrawRealisticFeatheredShuttlecock(pixels, width, height, width * 0.26f, height * 0.28f, 0.55f, 0.78f, featherColor, secondary, voltAccent);
        }
        else
        {
            // "smash-impact": Dynamic angled racket striking a blazing shuttlecock
            DrawSwooshTrail(pixels, width, height, mirror, phase, voltAccent, secondary);
            var racketX = mirror ? width * 0.60f : width * 0.40f;
            var shuttleX = mirror ? width * 0.38f : width * 0.62f;
            DrawProBadmintonRacket(pixels, width, height, racketX, height * 0.45f, mirror ? 0.46f : -0.46f, 1.18f, voltAccent, fgToken, secondary);
            DrawImpactBurst(pixels, width, height, (racketX + shuttleX) * 0.5f, height * 0.39f, 95f, voltAccent, secondary);
            DrawRealisticFeatheredShuttlecock(pixels, width, height, shuttleX, height * 0.37f, mirror ? 0.72f : -0.72f, 1.28f, featherColor, secondary, voltAccent);
        }

        // 4. Subtle 1px inner card border matching `border-border` (#233a2f)
        DrawInnerFrameBorder(pixels, width, height, borderToken);

        return EncodeRgbPng(pixels, width, height);
    }

    private static (byte R, byte G, byte B) ClampToBotanicalDark((byte R, byte G, byte B) color)
    {
        var r = (byte)Math.Clamp((int)color.R, 6, 32);
        var g = (byte)Math.Clamp(Math.Max((int)color.G, r + 10), 18, 66);
        var b = (byte)Math.Clamp((int)color.B, 12, 52);
        return (r, g, b);
    }

    /// <summary>
    /// Draws a full, unmistakable badminton racket:
    /// - Isometric oval head with outer frame & inner rim highlight
    /// - Crossed tensioned string mesh inside the head
    /// - Y-shaped throat / T-joint connecting the head to the shaft
    /// - Slender graphite shaft, cone cap, and ribbed wrapped grip handle
    /// </summary>
    private static void DrawProBadmintonRacket(
        byte[] pixels,
        int width,
        int height,
        float headCenterX,
        float headCenterY,
        float angleRad,
        float scale,
        (byte R, byte G, byte B) frameColor,
        (byte R, byte G, byte B) stringColor,
        (byte R, byte G, byte B) accentTrimColor)
    {
        var cos = MathF.Cos(angleRad);
        var sin = MathF.Sin(angleRad);
        const float rx = 92f;
        const float ry = 116f;

        var bound = (int)(340f * scale);
        var minX = Math.Max(0, (int)headCenterX - bound);
        var maxX = Math.Min(width - 1, (int)headCenterX + bound);
        var minY = Math.Max(0, (int)headCenterY - bound);
        var maxY = Math.Min(height - 1, (int)headCenterY + bound);

        var darkShaft = (R: (byte)14, G: (byte)31, B: (byte)23);

        for (var y = minY; y <= maxY; y++)
        {
            for (var x = minX; x <= maxX; x++)
            {
                var dx = (x - headCenterX) / scale;
                var dy = (y - headCenterY) / scale;
                var lx = dx * cos + dy * sin;
                var ly = -dx * sin + dy * cos;

                var absLx = MathF.Abs(lx);

                // 1. Isometric Oval Head & String Bed
                var normX = lx / rx;
                var normY = ly / ry;
                var ellipse = normX * normX + normY * normY;

                if (ellipse <= 1.16f && ellipse >= 0.84f)
                {
                    // Outer racket frame with two-tone sport paint at 10 & 2 o'clock and 4 & 8 o'clock
                    var twoTone = (ly < -ry * 0.25f && absLx > rx * 0.45f) || (ly > ry * 0.35f && absLx > rx * 0.35f);
                    var rimCol = twoTone ? accentTrimColor : frameColor;
                    if (ellipse is >= 0.96f and <= 1.04f)
                    {
                        rimCol = LerpColor(rimCol, stringColor, 0.35f);
                    }

                    BlendPixel(pixels, width, x, y, rimCol, 0.96f);
                    continue;
                }

                if (ellipse < 0.84f)
                {
                    // Fine crossed badminton strings (vertical mains + horizontal crosses)
                    var mainDist = MathF.Abs((lx + 200f) % 11.5f - 5.75f);
                    var crossDist = MathF.Abs((ly + 200f) % 11.5f - 5.75f);
                    if (mainDist < 0.95f || crossDist < 0.95f)
                    {
                        // Sweet-spot highlight near center of string bed
                        var sweetSpot = ellipse < 0.28f;
                        var sCol = sweetSpot ? accentTrimColor : stringColor;
                        BlendPixel(pixels, width, x, y, sCol, sweetSpot ? 0.58f : 0.38f);
                    }

                    continue;
                }

                // 2. Y-Throat / T-Joint (ly from ry*0.95 to ry + 36)
                if (ly >= ry * 0.92f && ly <= ry + 36f)
                {
                    var t = (ly - ry * 0.92f) / (36f + ry * 0.08f);
                    var armCenter = 24f * (1f - t);
                    if (MathF.Abs(absLx - armCenter) <= 4.2f || (t > 0.72f && absLx <= 6.5f))
                    {
                        BlendPixel(pixels, width, x, y, accentTrimColor, 0.94f);
                        continue;
                    }
                }

                // 3. Slender Graphite Shaft (ly from ry + 36 to ry + 122)
                if (ly > ry + 36f && ly <= ry + 122f && absLx <= 3.8f)
                {
                    var shaftCol = ((int)ly / 14) % 2 == 0 ? frameColor : LerpColor(frameColor, stringColor, 0.4f);
                    BlendPixel(pixels, width, x, y, shaftCol, 0.94f);
                    continue;
                }

                // 4. Cone Cap (ly from ry + 122 to ry + 142)
                if (ly > ry + 122f && ly <= ry + 142f)
                {
                    var ct = (ly - (ry + 122f)) / 20f;
                    var coneHalfW = 3.8f + ct * 5.2f;
                    if (absLx <= coneHalfW)
                    {
                        BlendPixel(pixels, width, x, y, accentTrimColor, 0.95f);
                        continue;
                    }
                }

                // 5. Wrapped Grip Handle + Butt Cap (ly from ry + 142 to ry + 228)
                if (ly > ry + 142f && ly <= ry + 228f)
                {
                    var isButtCap = ly > ry + 216f;
                    var gripHalfW = isButtCap ? 10.5f : 9.0f;
                    if (absLx <= gripHalfW)
                    {
                        if (isButtCap)
                        {
                            BlendPixel(pixels, width, x, y, frameColor, 0.96f);
                        }
                        else
                        {
                            // Diagonal overgrip tape wrap lines
                            var wrapBand = MathF.Abs(((ly + lx * 0.45f) % 13f) - 6.5f) < 1.3f;
                            var gripCol = wrapBand ? accentTrimColor : LerpColor(darkShaft, stringColor, 0.22f);
                            BlendPixel(pixels, width, x, y, gripCol, 0.95f);
                        }
                    }
                }
            }
        }
    }

    /// <summary>
    /// Draws a realistic, unmistakable feathered badminton shuttlecock:
    /// - Smooth hemispherical white cork base at the nose
    /// - Crisp colored trim ribbon around the cork collar
    /// - Flared conical crown of 8 overlapping pointed goose feathers with quill stems
    /// - Two horizontal binding threads across the feather stems
    /// </summary>
    private static void DrawRealisticFeatheredShuttlecock(
        byte[] pixels,
        int width,
        int height,
        float centerX,
        float centerY,
        float angleRad,
        float scale,
        (byte R, byte G, byte B) featherColor,
        (byte R, byte G, byte B) ribbonColor,
        (byte R, byte G, byte B) accentColor)
    {
        var cos = MathF.Cos(angleRad);
        var sin = MathF.Sin(angleRad);
        var bound = (int)(150f * scale);

        var minX = Math.Max(0, (int)centerX - bound);
        var maxX = Math.Min(width - 1, (int)centerX + bound);
        var minY = Math.Max(0, (int)centerY - bound);
        var maxY = Math.Min(height - 1, (int)centerY + bound);

        var featherShadow = (R: (byte)167, G: (byte)189, B: (byte)177); // --fg-muted

        for (var y = minY; y <= maxY; y++)
        {
            for (var x = minX; x <= maxX; x++)
            {
                var dx = (x - centerX) / scale;
                var dy = (y - centerY) / scale;
                // In local shuttle coordinates:
                // ly = +55 is the rounded cork nose tip (pointing down-forward)
                // ly = +24..+34 is the colored collar ribbon
                // ly = -76..+24 is the flared conical feather skirt
                var lx = dx * cos + dy * sin;
                var ly = -dx * sin + dy * cos;
                var absLx = MathF.Abs(lx);

                // 1. Hemispherical Cork Base (centered at (0, 34), radius 24, extending down to ly = +58)
                if (ly >= 31f)
                {
                    var corkDist = MathF.Sqrt(lx * lx + (ly - 34f) * (ly - 34f));
                    if (corkDist <= 24.5f)
                    {
                        var shadeT = (lx + 24f) / 48f * 0.25f + (58f - ly) / 28f * 0.15f;
                        var corkCol = LerpColor(featherShadow, featherColor, Math.Clamp(0.68f + shadeT, 0f, 1f));
                        var aa = Math.Clamp((24.5f - corkDist) * scale, 0f, 1f);
                        BlendPixel(pixels, width, x, y, corkCol, aa * 0.98f);
                        continue;
                    }
                }

                // 2. Colored Trim Band / Collar Ribbon (ly in 23..32)
                if (ly is >= 23f and < 32f && absLx <= 24.5f)
                {
                    var bandCol = ly < 26.5f ? accentColor : ribbonColor;
                    BlendPixel(pixels, width, x, y, bandCol, 0.98f);
                    continue;
                }

                // 3. Flared Conical Feather Crown (ly from -78 at feather tips to +23 at collar)
                if (ly is >= -78f and < 23f)
                {
                    var t = (23f - ly) / 101f; // t = 0 at collar, t = 1 at outer feather tips
                    var skirtHalfW = 23.5f + t * 48f;
                    if (absLx <= skirtHalfW)
                    {
                        var u = lx / skirtHalfW; // -1 .. +1 across the skirt width
                        const float featherCount = 7.5f;
                        var fPos = (u + 1f) * 0.5f * featherCount;
                        var fIdx = MathF.Floor(fPos);
                        var fFrac = fPos - fIdx; // 0..1 within a single feather
                        var distFromStem = MathF.Abs(fFrac - 0.5f) * 2f; // 0 at quill stem, 1 at feather edge

                        // Pointed diamond feather tips at the top of the crown (t > 0.72)
                        if (t > 0.72f)
                        {
                            var tipT = (t - 0.72f) / 0.28f;
                            if (distFromStem > (1f - tipT * 0.92f))
                            {
                                continue; // Creates crisp V-notches between individual pointed feathers!
                            }
                        }

                        // Lower stem window (between t = 0.04 and t = 0.34, feathers narrow to stems with small gaps)
                        if (t < 0.34f && distFromStem > 0.62f)
                        {
                            // Two horizontal binding threads at t = 0.14 and t = 0.27
                            var isBindingThread = MathF.Abs(t - 0.14f) < 0.028f || MathF.Abs(t - 0.27f) < 0.028f;
                            if (isBindingThread)
                            {
                                BlendPixel(pixels, width, x, y, featherColor, 0.92f);
                            }

                            continue;
                        }

                        var isQuillStem = distFromStem < 0.14f;
                        var isBindingRing = MathF.Abs(t - 0.14f) < 0.026f || MathF.Abs(t - 0.27f) < 0.026f;
                        var isFeatherEdge = distFromStem > 0.84f;

                        (byte R, byte G, byte B) col;
                        if (isBindingRing)
                        {
                            col = LerpColor(featherColor, ribbonColor, 0.45f);
                        }
                        else if (isQuillStem)
                        {
                            col = featherColor;
                        }
                        else if (isFeatherEdge)
                        {
                            col = LerpColor(featherShadow, ribbonColor, 0.30f);
                        }
                        else
                        {
                            // Overlapping vane shading so each feather has 3D depth
                            var vaneShade = fFrac < 0.5f ? 0.94f : 0.78f;
                            col = LerpColor(featherShadow, featherColor, vaneShade);
                        }

                        BlendPixel(pixels, width, x, y, col, 0.96f);
                    }
                }
            }
        }
    }

    private static void DrawImpactBurst(
        byte[] pixels,
        int width,
        int height,
        float cx,
        float cy,
        float maxRadius,
        (byte R, byte G, byte B) voltColor,
        (byte R, byte G, byte B) secondaryColor)
    {
        // Concentric shockwave rings + radial spark streaks
        DrawConcentricRings(pixels, width, height, cx, cy, [maxRadius * 0.45f, maxRadius * 0.78f, maxRadius * 1.12f], voltColor, secondaryColor);

        const int rays = 12;
        for (var i = 0; i < rays; i++)
        {
            var angle = i * (MathF.PI * 2f / rays) + 0.2f;
            var cos = MathF.Cos(angle);
            var sin = MathF.Sin(angle);
            var rStart = maxRadius * 0.32f;
            var rEnd = maxRadius * (i % 2 == 0 ? 1.05f : 0.75f);
            for (var r = rStart; r <= rEnd; r += 2f)
            {
                var px = cx + cos * r;
                var py = cy + sin * r;
                var col = i % 2 == 0 ? voltColor : secondaryColor;
                BlendDisc(pixels, width, height, px, py, 2.0f, col, 0.55f);
            }
        }
    }

    private static void DrawSwooshTrail(
        byte[] pixels,
        int width,
        int height,
        bool mirror,
        float phase,
        (byte R, byte G, byte B) voltColor,
        (byte R, byte G, byte B) secondaryColor)
    {
        for (var ribbon = -1; ribbon <= 1; ribbon++)
        {
            var yOff = ribbon * 18f;
            for (var step = 0; step < 800; step++)
            {
                var t = step / 799f;
                var xNorm = mirror ? 1f - t : t;
                var px = width * (0.06f + xNorm * 0.88f);
                var py = height * (0.78f - 0.50f * MathF.Sin(t * MathF.PI * 0.90f + phase * 0.1f)) + yOff;
                var radius = (ribbon == 0 ? 3.8f : 2.0f) * MathF.Sin(t * MathF.PI);
                if (radius <= 0.2f) continue;
                var col = ribbon == 0 ? LerpColor(secondaryColor, voltColor, t) : secondaryColor;
                BlendDisc(pixels, width, height, px, py, radius, col, ribbon == 0 ? 0.42f : 0.22f);
            }
        }
    }

    private static void DrawSchedulePillsBackdrop(
        byte[] pixels,
        int width,
        int height,
        byte[] seed,
        (byte R, byte G, byte B) surface2,
        (byte R, byte G, byte B) border,
        (byte R, byte G, byte B) volt,
        (byte R, byte G, byte B) secondary)
    {
        (float Cx, float Cy, float W, float H, bool Highlight)[] pills =
        [
            (width * (0.15f + (seed[7] % 18) * 0.004f), height * 0.18f, 128f, 32f, (seed[8] & 1) == 0),
            (width * (0.84f - (seed[9] % 18) * 0.004f), height * 0.20f, 116f, 32f, (seed[8] & 1) != 0),
            (width * (0.16f + (seed[10] % 16) * 0.004f), height * 0.82f, 140f, 32f, false),
            (width * (0.83f - (seed[11] % 16) * 0.004f), height * 0.80f, 122f, 32f, true),
        ];

        foreach (var pill in pills)
        {
            var stroke = pill.Highlight ? LerpColor(border, volt, 0.45f) : border;
            var fill = pill.Highlight ? LerpColor(surface2, secondary, 0.14f) : surface2;
            DrawRoundedContainerBadge(pixels, width, height, pill.Cx, pill.Cy, pill.W, pill.H, 16f, fill, stroke, fillAlpha: 0.38f);
            var dotX = pill.Cx - pill.W * 0.34f;
            var dotCol = pill.Highlight ? volt : secondary;
            BlendDisc(pixels, width, height, dotX, pill.Cy, 4.2f, dotCol, 0.72f);
        }
    }

    private static void DrawRoundedContainerBadge(
        byte[] pixels,
        int width,
        int height,
        float cx,
        float cy,
        float boxW,
        float boxH,
        float cornerRadius,
        (byte R, byte G, byte B) fillColor,
        (byte R, byte G, byte B) strokeColor,
        float fillAlpha)
    {
        var halfW = boxW * 0.5f;
        var halfH = boxH * 0.5f;
        var minX = Math.Max(0, (int)(cx - halfW - 3));
        var maxX = Math.Min(width - 1, (int)(cx + halfW + 3));
        var minY = Math.Max(0, (int)(cy - halfH - 3));
        var maxY = Math.Min(height - 1, (int)(cy + halfH + 3));

        var innerW = MathF.Max(0f, halfW - cornerRadius);
        var innerH = MathF.Max(0f, halfH - cornerRadius);

        for (var y = minY; y <= maxY; y++)
        {
            for (var x = minX; x <= maxX; x++)
            {
                var qx = MathF.Abs(x - cx) - innerW;
                var qy = MathF.Abs(y - cy) - innerH;
                var dist = MathF.Sqrt(MathF.Max(qx, 0f) * MathF.Max(qx, 0f) + MathF.Max(qy, 0f) * MathF.Max(qy, 0f))
                    + MathF.Min(MathF.Max(qx, qy), 0f)
                    - cornerRadius;

                if (dist <= 0f)
                {
                    if (MathF.Abs(dist) <= 1.8f)
                    {
                        BlendPixel(pixels, width, x, y, strokeColor, 0.65f);
                    }
                    else
                    {
                        BlendPixel(pixels, width, x, y, fillColor, fillAlpha);
                    }
                }
            }
        }
    }

    private static void DrawConcentricRings(
        byte[] pixels,
        int width,
        int height,
        float cx,
        float cy,
        float[] radii,
        (byte R, byte G, byte B) colorA,
        (byte R, byte G, byte B) colorB)
    {
        var maxR = (int)radii.Max() + 4;
        var minX = Math.Max(0, (int)cx - maxR);
        var maxX = Math.Min(width - 1, (int)cx + maxR);
        var minY = Math.Max(0, (int)cy - maxR);
        var maxY = Math.Min(height - 1, (int)cy + maxR);

        for (var y = minY; y <= maxY; y++)
        {
            for (var x = minX; x <= maxX; x++)
            {
                var d = MathF.Sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy));
                for (var i = 0; i < radii.Length; i++)
                {
                    var delta = MathF.Abs(d - radii[i]);
                    if (delta < 1.6f)
                    {
                        var col = i % 2 == 0 ? colorA : colorB;
                        BlendPixel(pixels, width, x, y, col, (1f - delta / 1.6f) * 0.45f);
                    }
                }
            }
        }
    }

    private static void DrawInnerFrameBorder(byte[] pixels, int width, int height, (byte R, byte G, byte B) borderColor)
    {
        for (var x = 0; x < width; x++)
        {
            BlendPixel(pixels, width, x, 0, borderColor, 0.7f);
            BlendPixel(pixels, width, x, height - 1, borderColor, 0.7f);
        }

        for (var y = 0; y < height; y++)
        {
            BlendPixel(pixels, width, 0, y, borderColor, 0.7f);
            BlendPixel(pixels, width, width - 1, y, borderColor, 0.7f);
        }
    }

    private static void BlendDisc(
        byte[] pixels,
        int width,
        int height,
        float cx,
        float cy,
        float radius,
        (byte R, byte G, byte B) color,
        float alpha)
    {
        var rInt = (int)MathF.Ceiling(radius);
        var minX = Math.Max(0, (int)cx - rInt);
        var maxX = Math.Min(width - 1, (int)cx + rInt);
        var minY = Math.Max(0, (int)cy - rInt);
        var maxY = Math.Min(height - 1, (int)cy + rInt);

        for (var y = minY; y <= maxY; y++)
        {
            for (var x = minX; x <= maxX; x++)
            {
                var d = MathF.Sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy));
                if (d <= radius)
                {
                    var falloff = (1f - d / radius) * alpha;
                    BlendPixel(pixels, width, x, y, color, falloff);
                }
            }
        }
    }

    private static void BlendPixel(byte[] pixels, int width, int x, int y, (byte R, byte G, byte B) color, float alpha)
    {
        var existing = GetPixel(pixels, width, x, y);
        SetPixel(pixels, width, x, y, LerpColor(existing, color, alpha));
    }

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
        ihdr[8] = 8;
        ihdr[9] = 2;
        ihdr[10] = 0;
        ihdr[11] = 0;
        ihdr[12] = 0;
        WritePngChunk(output, "IHDR"u8, ihdr);

        using var compressed = new MemoryStream();
        using (var zlib = new ZLibStream(compressed, CompressionLevel.Fastest, leaveOpen: true))
        {
            var rowStride = width * 3;
            for (var y = 0; y < height; y++)
            {
                zlib.WriteByte(0);
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

    private sealed record CourtArtworkSpec(
        string ThemeTitle,
        string? BgStartHex,
        string? BgEndHex,
        string? GlowHex,
        string? SecondaryAccentHex,
        string? FeatherHex,
        string? Composition,
        string? BackdropGrid,
        string? GlowCorner);
}
