using System.Collections.Concurrent;

namespace ShuttleSync.Api.Auth;

public sealed class AuthRateLimiter
{
    private const int MaxKeys = 4096;
    private static readonly TimeSpan Window = TimeSpan.FromMinutes(15);
    private readonly Dictionary<string, Queue<DateTimeOffset>> _attempts = new(StringComparer.Ordinal);
    private readonly Lock _gate = new();

    public bool Permit(string ipAddress, string email)
    {
        var safeEmail = email.Length <= 256 ? email : email[..256];
        var key = $"{ipAddress}|{safeEmail}";
        var now = DateTimeOffset.UtcNow;
        var cutoff = now - Window;

        lock (_gate)
        {
            if (_attempts.Count >= MaxKeys && !_attempts.ContainsKey(key))
            {
                PruneExpired(cutoff);
                if (_attempts.Count >= MaxKeys)
                {
                    var oldestKey = _attempts.Keys.FirstOrDefault();
                    if (oldestKey is not null)
                    {
                        _attempts.Remove(oldestKey);
                    }
                }
            }

            if (!_attempts.TryGetValue(key, out var attempts))
            {
                attempts = new Queue<DateTimeOffset>();
                _attempts[key] = attempts;
            }

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

    private void PruneExpired(DateTimeOffset cutoff)
    {
        var emptyKeys = new List<string>();
        foreach (var (key, queue) in _attempts)
        {
            while (queue.Count > 0 && queue.Peek() <= cutoff)
            {
                queue.Dequeue();
            }

            if (queue.Count == 0)
            {
                emptyKeys.Add(key);
            }
        }

        foreach (var key in emptyKeys)
        {
            _attempts.Remove(key);
        }
    }
}
