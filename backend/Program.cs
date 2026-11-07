using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.Identity;
using Microsoft.IdentityModel.Tokens;
using ShuttleSync.Api.Auth;
using ShuttleSync.Api.Booking;
using ShuttleSync.Api.Configuration;
using ShuttleSync.Api.Data;
using ShuttleSync.Api.Media;
using ShuttleSync.Api.Support;

// Load the development file.
EnvLoader.LoadDevelopmentFile();

// Create the web application builder.
var builder = WebApplication.CreateBuilder(args);

// Load the authentication settings from the configuration.
var authSettings = AuthSettings.FromConfiguration(builder.Configuration);
var cloudinarySettings = CloudinarySettings.FromConfiguration(builder.Configuration);
var stripeSettings = StripeSettings.FromConfiguration(builder.Configuration);
if (stripeSettings.IsConfigured)
{
    Stripe.StripeConfiguration.ApiKey = stripeSettings.SecretKey;
}
var geminiSettings = GeminiSettings.FromConfiguration(builder.Configuration);

var port = Environment.GetEnvironmentVariable("PORT");
if (!string.IsNullOrWhiteSpace(port))
{
    builder.WebHost.UseUrls($"http://0.0.0.0:{port}");
}

// Add services to the container.
builder.Services.AddSingleton(authSettings);
builder.Services.AddSingleton(cloudinarySettings);
builder.Services.AddSingleton(stripeSettings);
builder.Services.AddSingleton(geminiSettings);
builder.Services.AddSingleton<SupportChatLimiter>();
builder.Services.AddSingleton<CloudinaryImages>();
builder.Services.AddSingleton<CourtAiImageGenerator>();
builder.Services.AddSingleton<AccessTokens>();
builder.Services.AddSingleton<AuthRateLimiter>();
builder.Services.AddSingleton<PasswordHasher<UserRow>>();
builder.Services.AddScoped<AuthRepository>();
builder.Services.AddScoped<BookingRepository>();
builder.Services.AddScoped<DashboardRepository>();
builder.Services.AddScoped<DashboardStatsRepository>();
builder.Services.AddScoped<RecommendationRepository>();
builder.Services.AddSingleton<ComebackCopy>();
builder.Services.AddSingleton<WeekChangeCopy>();
builder.Services.AddScoped<PaymentRepository>();
builder.Services.AddScoped<BookingPayments>();
builder.Services.AddHostedService<BookingMaintenanceService>();
builder.Services.AddHttpClient("oauth", client => client.Timeout = TimeSpan.FromSeconds(15));
builder.Services.AddHttpClient("cloudinary", client => client.Timeout = TimeSpan.FromSeconds(30));
builder.Services.AddHttpClient("gemini", client => client.Timeout = TimeSpan.FromSeconds(45));
builder.Services.ConfigureHttpJsonOptions(options =>
{
    options.SerializerOptions.Converters.Add(new LenientNullableDecimalConverter());
    options.SerializerOptions.Converters.Add(new LenientNullableIntConverter());
});
builder.Services.Configure<ForwardedHeadersOptions>(options =>
{
    options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
    options.ForwardLimit = 2;
    options.KnownIPNetworks.Clear();
    options.KnownProxies.Clear();
});

// Add authentication services to the container.
var signingKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(authSettings.JwtSigningKey));
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.MapInboundClaims = false;
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidIssuer = authSettings.JwtIssuer,
            ValidateAudience = true,
            ValidAudience = authSettings.JwtAudience,
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = signingKey,
            ValidateLifetime = true,
            ClockSkew = TimeSpan.FromSeconds(30),
        };
        options.Events = new JwtBearerEvents
        {
            OnMessageReceived = context =>
            {
                if (AuthCookies.TryGetAccess(context.HttpContext, out var accessToken))
                {
                    context.Token = accessToken;
                }

                return Task.CompletedTask;
            },
        };
    });
// Add authorization services to the container.
builder.Services.AddAuthorization();

// Add CORS services to the container.
builder.Services.AddCors(options =>
{
    options.AddPolicy("Frontend", policy =>
    {
        if (string.IsNullOrWhiteSpace(authSettings.FrontendOrigin))
        {
            return;
        }

        policy.WithOrigins(authSettings.FrontendOrigin)
            .AllowCredentials()
            .WithHeaders("Content-Type", "X-CSRF-Token")
            .WithMethods(HttpMethods.Get, HttpMethods.Post, HttpMethods.Put, HttpMethods.Delete);
    });
});

// Build the application.
var app = builder.Build();

// Use the application.
app.UseForwardedHeaders();
app.UseExceptionHandler(exceptionApp =>
{
    exceptionApp.Run(async context =>
    {
        var feature = context.Features.Get<Microsoft.AspNetCore.Diagnostics.IExceptionHandlerFeature>();
        if (feature?.Error is BadHttpRequestException)
        {
            context.Response.StatusCode = StatusCodes.Status400BadRequest;
            await context.Response.WriteAsJsonAsync(new { message = "The request payload was not valid." });
            return;
        }

        context.Response.StatusCode = StatusCodes.Status500InternalServerError;
        await context.Response.WriteAsJsonAsync(new { message = "An unexpected error occurred." });
    });
});
app.Use(async (context, next) =>
{
    context.Response.Headers["X-Content-Type-Options"] = "nosniff";
    context.Response.Headers["X-Frame-Options"] = "DENY";
    context.Response.Headers["Referrer-Policy"] = "strict-origin-when-cross-origin";
    await next();
});
app.UseCors("Frontend");
app.UseAuthentication();
app.UseAuthorization();
app.UseMiddleware<CsrfMiddleware>();

app.MapGet("/api/health", () => Results.Ok(new
{
    status = "ok",
    service = "ShuttleSync.Api",
}));

app.MapAuthEndpoints();
app.MapOAuthEndpoints();
app.MapVenueEndpoints();
app.MapProfileEndpoints();
app.MapDashboardEndpoints();
app.MapDashboardStatsEndpoints();
app.MapCheckoutEndpoints();
app.MapSupportEndpoints();

app.Run();
