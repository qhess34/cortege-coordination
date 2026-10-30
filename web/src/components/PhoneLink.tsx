// Numéro de téléphone cliquable (appel direct depuis un téléphone).

/** 0612345678 → 06 12 34 56 78 ; +33611223344 → +33 6 11 22 33 44 ; sinon tel quel. */
export function formatPhone(p: string): string {
  if (/^0\d{9}$/.test(p)) return p.replace(/(\d{2})(?=\d)/g, '$1 ');
  if (/^\+33\d{9}$/.test(p)) return '+33 ' + p.slice(3, 4) + ' ' + p.slice(4).replace(/(\d{2})(?=\d)/g, '$1 ');
  return p;
}

export function PhoneLink({ phone, name }: { phone: string; name?: string }) {
  return <a className="phone" href={'tel:' + phone} aria-label={name ? 'Appeler ' + name : undefined}>📞 {formatPhone(phone)}</a>;
}
