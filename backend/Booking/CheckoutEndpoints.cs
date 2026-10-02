using ShuttleSync.Api.Auth;
using ShuttleSync.Api.Data;

namespace ShuttleSync.Api.Booking;

public static class CheckoutEndpoints
{
    public static void MapCheckoutEndpoints(this WebApplication app)
    {
        var checkout = app.MapGroup("/api/venues").RequireAuthorization();
        checkout.MapPost("/{slug}/sessions/{sessionId:guid}/checkout", CheckoutAsync);
        app.MapPost("/api/stripe/webhook", (HttpContext http, BookingPayments payments, CancellationToken cancellationToken) =>
            payments.WebhookAsync(http, cancellationToken));
    }

    private static async Task<IResult> CheckoutAsync(
        string slug,
        Guid sessionId,
        CheckoutBody body,
        HttpContext http,
        AuthRepository authRepository,
        BookingRepository repository,
        BookingPayments payments,
        AuthSettings authSettings,
        CancellationToken cancellationToken)
    {
        var current = await AuthEndpoints.CurrentSessionAsync(http, authRepository, cancellationToken);
        if (current is null)
        {
            return Form("Sign in again.", StatusCodes.Status401Unauthorized);
        }

        var venue = await repository.FindActiveVenueBySlugAsync(slug, cancellationToken);
        if (venue is null)
        {
            return Form("That venue was not found.", StatusCodes.Status404NotFound);
        }

        var origin = authSettings.FrontendOrigin.TrimEnd('/');
        var successUrl = $"{origin}/{slug}/book/{sessionId}?checkout=success";
        var cancelUrl = $"{origin}/{slug}/book/{sessionId}?checkout=cancel";
        var result = await payments.CheckoutAsync(venue.Id, sessionId, current.UserId, body.Points, body.PromotionCode, successUrl, cancelUrl, cancellationToken);
        if (result.Error is not null)
        {
            return Form(result.Error, result.StatusCode);
        }

        return Results.Ok(new
        {
            bookingId = result.BookingId,
            status = result.Status,
            checkoutUrl = result.CheckoutUrl,
            currency = result.Currency,
            subtotal = result.Subtotal,
            discountAmount = result.DiscountAmount,
            pointsRedeemed = result.PointsRedeemed,
            pointsValue = result.PointsValue,
            cashAmount = result.CashAmount,
        });
    }

    private static IResult Form(string message, int status) =>
        Results.Json(new { errors = new Dictionary<string, string[]> { ["form"] = [message] } }, statusCode: status);

    private sealed record CheckoutBody(int Points, string? PromotionCode = null);
}
