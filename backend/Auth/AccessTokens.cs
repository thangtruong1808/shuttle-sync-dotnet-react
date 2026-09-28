using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using Microsoft.IdentityModel.Tokens;
using ShuttleSync.Api.Data;

namespace ShuttleSync.Api.Auth;

public sealed class AccessTokens
{
    private readonly JwtSecurityTokenHandler _handler = new();
    private readonly SigningCredentials _credentials;
    private readonly AuthSettings _settings;

    public AccessTokens(AuthSettings settings)
    {
        _settings = settings;
        _credentials = new SigningCredentials(
            new SymmetricSecurityKey(System.Text.Encoding.UTF8.GetBytes(settings.JwtSigningKey)),
            SecurityAlgorithms.HmacSha256);
    }

    public string Create(UserRow user, Guid sessionId)
    {
        var now = DateTime.UtcNow;
        var token = new JwtSecurityToken(
            issuer: _settings.JwtIssuer,
            audience: _settings.JwtAudience,
            claims:
            [
                new Claim("sub", user.Id.ToString()),
                new Claim("sid", sessionId.ToString()),
                new Claim("email", user.Email),
            ],
            notBefore: now,
            expires: now.AddMinutes(_settings.AccessTokenMinutes),
            signingCredentials: _credentials);

        return _handler.WriteToken(token);
    }
}
