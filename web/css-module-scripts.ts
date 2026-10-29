// Plugin Vite : prise en charge des « CSS module scripts » (`import s from "x.css" with { type: "css" }`)
// utilisés par le viewer Panoramax. Chaque feuille devient un CSSStyleSheet construit ; ses url(...) relatives
// sont importées comme ressources pour rester valides une fois empaquetées.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Plugin } from 'vite';

const PREFIX = '\0css-module-script:';
const URL_RE = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;

export function cssModuleScripts(packages: string[]): Plugin {
  return {
    name: 'css-module-scripts',
    enforce: 'pre',
    async resolveId(source, importer) {
      if (!importer || !source.split('?')[0]!.endsWith('.css')) return null;
      if (!packages.some((p) => importer.includes('/node_modules/' + p + '/'))) return null;
      const r = await this.resolve(source, importer, { skipSelf: true });
      // Suffixe .js : sinon Vite retraiterait le module comme une feuille CSS.
      return r ? PREFIX + r.id.split('?')[0] + '.js' : null;
    },
    load(id) {
      if (!id.startsWith(PREFIX)) return null;
      const file = id.slice(PREFIX.length, -'.js'.length);
      const css = readFileSync(file, 'utf8');
      const imports: string[] = [];
      const parts: string[] = [];
      let last = 0;
      for (const m of css.matchAll(URL_RE)) {
        const u = m[2]!;
        if (/^(data:|https?:|#|\/)/.test(u)) continue;
        const name = '__u' + imports.length;
        imports.push('import ' + name + ' from ' + JSON.stringify(resolve(dirname(file), u.split(/[?#]/)[0]!) + '?url') + ';');
        parts.push(JSON.stringify(css.slice(last, m.index)) + ' + "url(\\"" + ' + name + ' + "\\")"');
        last = m.index! + m[0].length;
      }
      parts.push(JSON.stringify(css.slice(last)));
      return imports.join('\n') + '\nconst sheet = new CSSStyleSheet();\nsheet.replaceSync(' + parts.join(' + ') + ');\nexport default sheet;\n';
    },
  };
}
