import nodemailer from "nodemailer";

let _transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter {
  if (!_transporter) {
    _transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || "localhost",
      port: Number(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === "true",
      auth: process.env.SMTP_USER
        ? {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
          }
        : undefined,
    });
  }
  return _transporter;
}

export async function sendMagicLinkEmail(email: string, token: string): Promise<void> {
  const baseUrl = process.env.OAUTH_REDIRECT_BASE || "http://localhost:3000";
  const magicLinkUrl = `${baseUrl}/api/auth/magic-link/verify?token=${token}`;
  const from = process.env.SMTP_FROM || "accal <noreply@localhost>";

  await getTransporter().sendMail({
    from,
    to: email,
    subject: "Sign in to accal",
    text: `Click this link to sign in to accal:\n\n${magicLinkUrl}\n\nThis link expires in 15 minutes.\n\nIf you didn't request this, you can safely ignore this email.`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 2rem;">
        <h2 style="color: #6366f1;">Sign in to accal</h2>
        <p>Click the button below to sign in:</p>
        <a href="${magicLinkUrl}" style="display: inline-block; background: #6366f1; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 500;">
          Sign in
        </a>
        <p style="color: #666; font-size: 0.875rem; margin-top: 1.5rem;">
          This link expires in 15 minutes. If you didn't request this, you can safely ignore this email.
        </p>
      </div>
    `,
  });
}
