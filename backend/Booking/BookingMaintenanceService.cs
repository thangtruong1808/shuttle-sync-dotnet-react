using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using ShuttleSync.Api.Data;

namespace ShuttleSync.Api.Booking;

public sealed class BookingMaintenanceService(
    IServiceScopeFactory scopeFactory,
    ILogger<BookingMaintenanceService> logger) : BackgroundService
{
    private static readonly TimeSpan SweepInterval = TimeSpan.FromSeconds(30);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            await Task.Delay(TimeSpan.FromSeconds(5), stoppingToken);
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            return;
        }

        await RunSweepSafeAsync(stoppingToken);

        using var timer = new PeriodicTimer(SweepInterval);
        try
        {
            while (await timer.WaitForNextTickAsync(stoppingToken))
            {
                await RunSweepSafeAsync(stoppingToken);
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            // Application is shutting down.
        }
    }

    private async Task RunSweepSafeAsync(CancellationToken cancellationToken)
    {
        try
        {
            await using var scope = scopeFactory.CreateAsyncScope();
            var payments = scope.ServiceProvider.GetRequiredService<BookingPayments>();
            var bookings = scope.ServiceProvider.GetRequiredService<BookingRepository>();

            await payments.ReleaseExpiredCourtHoldsAsync(cancellationToken, force: true);
            await payments.RefundStartedWaitlistsAsync(cancellationToken, force: true);
            await bookings.ExpirePublicSocialHoldsAsync(cancellationToken, force: true);
            await bookings.AwardEndedSocialIncentivesAsync(cancellationToken, force: true);
            await bookings.FillAllOpenWaitlistsAsync(cancellationToken);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            // Expected during shutdown.
        }
        catch (Exception exception)
        {
            logger.LogWarning(exception, "Background booking maintenance sweep failed.");
        }
    }
}

