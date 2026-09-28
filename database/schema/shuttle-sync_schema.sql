/*
    Shuttle Sync authentication schema for SQL Server.
    Safe to run more than once.
    The application stores emails already trimmed and lowercased.
    Refresh tokens are stored only as SHA-256 hashes.
*/

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;

IF NOT EXISTS (
    SELECT 1
    FROM sys.tables
    WHERE name = N'Users' AND schema_id = SCHEMA_ID(N'dbo')
)
BEGIN
    CREATE TABLE dbo.Users
    (
        Id uniqueidentifier NOT NULL
            CONSTRAINT PK_Users PRIMARY KEY,
        Email nvarchar(256) NOT NULL,
        EmailVerified bit NOT NULL
            CONSTRAINT DF_Users_EmailVerified DEFAULT (0),
        PasswordHash nvarchar(500) NULL,
        DisplayName nvarchar(200) NULL,
        CreatedAt datetimeoffset NOT NULL,
        UpdatedAt datetimeoffset NOT NULL,
        CONSTRAINT UQ_Users_Email UNIQUE (Email)
    );
END;

IF NOT EXISTS (
    SELECT 1
    FROM sys.tables
    WHERE name = N'ExternalLogins' AND schema_id = SCHEMA_ID(N'dbo')
)
BEGIN
    CREATE TABLE dbo.ExternalLogins
    (
        Id uniqueidentifier NOT NULL
            CONSTRAINT PK_ExternalLogins PRIMARY KEY,
        UserId uniqueidentifier NOT NULL,
        Provider nvarchar(32) NOT NULL,
        ProviderUserId nvarchar(128) NOT NULL,
        EmailAtLink nvarchar(256) NULL,
        CreatedAt datetimeoffset NOT NULL,
        CONSTRAINT FK_ExternalLogins_Users
            FOREIGN KEY (UserId) REFERENCES dbo.Users (Id) ON DELETE CASCADE,
        CONSTRAINT UQ_ExternalLogins_ProviderUser
            UNIQUE (Provider, ProviderUserId),
        CONSTRAINT CK_ExternalLogins_Provider
            CHECK (Provider IN (N'google', N'github'))
    );
END;

IF NOT EXISTS (
    SELECT 1
    FROM sys.tables
    WHERE name = N'Sessions' AND schema_id = SCHEMA_ID(N'dbo')
)
BEGIN
    CREATE TABLE dbo.Sessions
    (
        Id uniqueidentifier NOT NULL
            CONSTRAINT PK_Sessions PRIMARY KEY,
        UserId uniqueidentifier NOT NULL,
        FamilyId uniqueidentifier NOT NULL,
        RefreshTokenHash varbinary(32) NOT NULL,
        ReplacedBySessionId uniqueidentifier NULL,
        ExpiresAt datetimeoffset NOT NULL,
        RevokedAt datetimeoffset NULL,
        RevokeReason nvarchar(64) NULL,
        UserAgent nvarchar(512) NULL,
        IpAddress nvarchar(64) NULL,
        CreatedAt datetimeoffset NOT NULL,
        LastUsedAt datetimeoffset NOT NULL,
        CONSTRAINT FK_Sessions_Users
            FOREIGN KEY (UserId) REFERENCES dbo.Users (Id) ON DELETE CASCADE,
        CONSTRAINT UQ_Sessions_RefreshTokenHash UNIQUE (RefreshTokenHash)
    );
END;

IF NOT EXISTS (
    SELECT 1
    FROM sys.foreign_keys
    WHERE name = N'FK_Sessions_ReplacedBy'
)
BEGIN
    ALTER TABLE dbo.Sessions
        ADD CONSTRAINT FK_Sessions_ReplacedBy
            FOREIGN KEY (ReplacedBySessionId) REFERENCES dbo.Sessions (Id);
END;

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = N'IX_Sessions_UserId'
      AND object_id = OBJECT_ID(N'dbo.Sessions')
)
BEGIN
    CREATE INDEX IX_Sessions_UserId
        ON dbo.Sessions (UserId);
END;

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = N'IX_Sessions_FamilyId'
      AND object_id = OBJECT_ID(N'dbo.Sessions')
)
BEGIN
    CREATE INDEX IX_Sessions_FamilyId
        ON dbo.Sessions (FamilyId);
END;

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = N'IX_Sessions_Current'
      AND object_id = OBJECT_ID(N'dbo.Sessions')
)
BEGIN
    CREATE INDEX IX_Sessions_Current
        ON dbo.Sessions (UserId, ExpiresAt)
        WHERE ReplacedBySessionId IS NULL AND RevokedAt IS NULL;
END;
