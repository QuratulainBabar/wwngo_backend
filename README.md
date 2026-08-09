# WWNGO Backend

Node.js + Express API with PostgreSQL for the WWNGO mobile app.

## Prerequisites

- Node.js 18+
- PostgreSQL 14+

## Setup

```bash
cd backend
cp .env.example .env
# Edit .env with your PostgreSQL credentials

npm install
npm run db:migrate
npm run dev
```

The API runs at `http://localhost:3000`.

## Auth API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/auth/register` | Create account |
| POST | `/api/v1/auth/login` | Log in |
| POST | `/api/v1/auth/refresh` | Refresh access token |
| POST | `/api/v1/auth/logout` | Revoke refresh token |
| GET | `/api/v1/auth/me` | Get current user (Bearer token) |
| POST | `/api/v1/auth/forgot-password` | Send password reset OTP |
| POST | `/api/v1/auth/verify-otp` | Verify OTP, get reset token |
| POST | `/api/v1/auth/reset-password` | Reset password with reset token |
| POST | `/api/v1/auth/change-password` | Change password (authenticated) |
| POST | `/api/v1/auth/verify-email/send` | Send email verification OTP (Gmail SMTP) |
| POST | `/api/v1/auth/verify-email/verify` | Verify email with OTP (authenticated) |
| POST | `/api/v1/auth/verify-contact/send` | Send cross-verification OTP (email/phone) |
| POST | `/api/v1/auth/verify-contact/verify` | Verify contact OTP (authenticated) |

## Database Schema

- **users** — account profile, KYC status, wallet balance (defaults)
- **refresh_tokens** — JWT refresh token rotation
- **otp_codes** — password reset verification codes

Email OTPs are generated randomly and delivered through Gmail SMTP (`SMTP_USER` + `SMTP_PASS` App Password). OTP codes are never returned in API responses.
In development, phone OTP codes that cannot be delivered by SMS are logged to the server console only.
