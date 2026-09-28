using System.Collections.Concurrent;

namespace ShuttleSync.Api.Auth;

public sealed class AuthRateLimiter
{
    private static readonly TimeSpan Window = TimeSpan.FromMinutes(15);
    private readonly ConcurrentDictionary<string, Queue<DateTimeOffset>> _attempts = new();
    private readonly Lock _gate = new();

    public bool Permit(string ipAddress, string email)
    {
        var key = $"{ipAddress}|{email}";
        var now = DateTimeOffset.UtcNow;
        var cutoff = now - Window;

        lock (_gate)
        {
            var attempts = _attempts.GetOrAdd(key, _ => new Queue<DateTimeOffset>());
            while (attempts.Count > 0 && attempts.Peek() <= cutoff)
            {
                attempts.Dequeue();
            }

            if (attempts.Count >= 10)
            {
                return false;
            }

            attempts.Enqueue(now);
            return true;
        }
    }
}
