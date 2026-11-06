FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY backend/ShuttleSync.Api.csproj backend/
RUN dotnet restore backend/ShuttleSync.Api.csproj
COPY backend/ backend/
RUN dotnet publish backend/ShuttleSync.Api.csproj -c Release -o /app --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=build /app .
ENV ASPNETCORE_ENVIRONMENT=Production
ENV PORT=8080
EXPOSE 8080
ENTRYPOINT ["dotnet", "ShuttleSync.Api.dll"]
