// Envoi d'e-mails (liens de connexion), seulement si un serveur SMTP est configuré (SMTP_URL).
import nodemailer from 'nodemailer';

export type Mailer = (to: string, subject: string, text: string) => Promise<void>;

export function smtpMailer(url: string, from: string): Mailer {
  const transport = nodemailer.createTransport(url);
  return async (to, subject, text) => {
    await transport.sendMail({ from, to, subject, text });
  };
}
