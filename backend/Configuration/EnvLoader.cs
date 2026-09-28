using DotNetEnv;

namespace ShuttleSync.Api.Configuration;

public static class EnvLoader
{
    public static void LoadDevelopmentFile()
    {
        var environment = Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT");
        if (!string.Equals(environment, "Development", StringComparison.OrdinalIgnoreCase))
        {
            return;
        }

        var directory = new DirectoryInfo(Directory.GetCurrentDirectory());
        for (var depth = 0; depth < 6 && directory is not null; depth++)
        {
            var nested = Path.Combine(directory.FullName, "backend", ".env");
            if (File.Exists(nested))
            {
                Env.Load(nested);
                return;
            }

            if (string.Equals(directory.Name, "backend", StringComparison.OrdinalIgnoreCase))
            {
                var local = Path.Combine(directory.FullName, ".env");
                if (File.Exists(local))
                {
                    Env.Load(local);
                    return;
                }
            }

            directory = directory.Parent;
        }
    }
}
