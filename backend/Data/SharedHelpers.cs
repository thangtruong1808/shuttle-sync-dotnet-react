using MySqlConnector;

namespace ShuttleSync.Api.Data;

public static class DbConnectionFactory
{
    public static async Task<MySqlConnection> OpenAsync(IConfiguration configuration, CancellationToken cancellationToken)
    {
        var connectionString = configuration.GetConnectionString("Default");
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            throw new InvalidOperationException("The MySQL connection string is not configured.");
        }

        var builder = new MySqlConnectionStringBuilder(connectionString)
        {
            GuidFormat = MySqlGuidFormat.Char36,
        };
        var connection = new MySqlConnection(builder.ConnectionString);
        await connection.OpenAsync(cancellationToken);
        return connection;
    }
}

public static class ProportionalShares
{
    public static decimal[] SplitMoney(decimal[] weights, decimal total)
    {
        var shares = new decimal[weights.Length];
        if (weights.Length == 0 || total <= 0)
        {
            return shares;
        }

        var sum = weights.Sum();
        var remaining = decimal.Round(Math.Min(total, sum), 2, MidpointRounding.AwayFromZero);
        for (var index = 0; index < weights.Length; index++)
        {
            var share = index == weights.Length - 1 || sum <= 0
                ? remaining
                : decimal.Round(remaining * weights[index] / sum, 2, MidpointRounding.AwayFromZero);
            if (share > weights[index])
            {
                share = weights[index];
            }

            if (share > remaining)
            {
                share = remaining;
            }

            if (share < 0)
            {
                share = 0;
            }

            shares[index] = share;
            remaining -= share;
            sum -= weights[index];
        }

        for (var index = 0; index < shares.Length && remaining > 0; index++)
        {
            var room = weights[index] - shares[index];
            var add = room < remaining ? room : remaining;
            shares[index] += add;
            remaining -= add;
        }

        return shares;
    }

    public static int[] SplitInt(decimal[] weights, int total)
    {
        var shares = new int[weights.Length];
        if (weights.Length == 0 || total <= 0)
        {
            return shares;
        }

        var sum = weights.Sum();
        var assigned = 0;
        for (var index = 0; index < weights.Length; index++)
        {
            if (index == weights.Length - 1)
            {
                shares[index] = total - assigned;
            }
            else
            {
                var share = sum <= 0 ? 0 : (int)decimal.Round(total * weights[index] / sum, 0, MidpointRounding.AwayFromZero);
                shares[index] = share;
                assigned += share;
            }

            if (shares[index] < 0)
            {
                shares[index] = 0;
            }
        }

        if (shares.Sum() != total && shares.Length > 0)
        {
            shares[^1] += total - shares.Sum();
        }

        return shares;
    }
}

public static class ClientIpHelper
{
    public static string GetClientIp(HttpContext http) =>
        GetOptionalClientIp(http) ?? "unknown";

    public static string? GetOptionalClientIp(HttpContext http)
    {
        var ipAddress = http.Connection.RemoteIpAddress?.ToString();
        if (string.IsNullOrWhiteSpace(ipAddress))
        {
            return null;
        }

        return ipAddress.Length > 64 ? ipAddress[..64] : ipAddress;
    }
}

