using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Identity;
using Microsoft.IdentityModel.Tokens;
using ShuttleSync.Api.Auth;
using ShuttleSync.Api.Configuration;
using ShuttleSync.Api.Data;

EnvLoader.LoadDevelopmentFile();

var builder = WebApplication.CreateBuilder(args);
var authSettings = AuthSettings.FromConfiguration(builder.Configuration);

var port = Environment.GetEnvironmentVariable("PORT");
if (!string.IsNullOrWhiteSpace(port))
{
    builder.WebHost.UseUrls($"http://0.0.0.0:{port}");
}

builder.Services.AddSingleton(authSettings);
builder.Services.AddSingleton<AccessTokens>();
builder.Services.AddSingleton<AuthRateLimiter>();
builder.Services.AddSingleton<PasswordHasher<UserRow>>();
builder.Services.AddScoped<AuthRepository>();
builder.Services.AddHttpClient("oauth", client => client.Timeout = TimeSpan.FromSeconds(15));

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
                if (context.Request.Cookies.TryGetValue(AuthCookies.Access, out var accessToken))
                {
                    context.Token = accessToken;
                }

                return Task.CompletedTask;
            },
        };
    });
builder.Services.AddAuthorization();

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
            .WithMethods(HttpMethods.Get, HttpMethods.Post, HttpMethods.Delete);
    });
});

var app = builder.Build();

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

app.Run();
