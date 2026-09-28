using System.Security.Cryptography;
using System.Text;

namespace ShuttleSync.Api.Auth;

public static class TokenProtection
{
    public static string CreateToken() => Base64Url(RandomNumberGenerator.GetBytes(32));

    public static byte[] Sha256(string value) => SHA256.HashData(Encoding.UTF8.GetBytes(value));

    public static string CreateCodeChallenge(string verifier) =>
        Base64Url(SHA256.HashData(Encoding.ASCII.GetBytes(verifier)));

    public static bool FixedTimeEquals(string left, string right)
    {
        var leftBytes = Encoding.UTF8.GetBytes(left);
        var rightBytes = Encoding.UTF8.GetBytes(right);
        return leftBytes.Length == rightBytes.Length
            && CryptographicOperations.FixedTimeEquals(leftBytes, rightBytes);
    }

    public static bool FixedTimeEquals(byte[] left, byte[] right) =>
        left.Length == right.Length && CryptographicOperations.FixedTimeEquals(left, right);

    public static string Base64Url(byte[] bytes) =>
        Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}
