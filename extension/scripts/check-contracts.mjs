// Fails when src/shared/contracts.ts drifts from ../contracts/*.xml:
// property names and types, method names and argument signatures, object paths.
import { readdirSync, readFileSync } from 'node:fs';
import { XMLParser } from 'fast-xml-parser';

const contractsDir = new URL('../../contracts/', import.meta.url);
const tsFile = new URL('../src/shared/contracts.ts', import.meta.url);

const TS_TYPE = {
    b: 'boolean',
    s: 'string',
    as: 'string[]',
    x: 'number',
    u: 'number',
    d: 'number',
    'a(xs)': 'Array<[number, string]>',
    'a{sv}': 'Record<string, unknown>',
};

const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    isArray: (name) => ['interface', 'property', 'method', 'signal', 'arg', 'annotation'].includes(name),
});

const ts = readFileSync(tsFile, 'utf8');
const errors = [];

/** Body of `export interface Name { ... }` as { member: type }. */
function tsInterface(name) {
    const match = ts.match(new RegExp(`export interface ${name} \\{([^}]*)\\}`));
    if (!match) return null;
    return Object.fromEntries(
        [...match[1].matchAll(/^\s*(\w+): ([^;]+);/gm)].map((m) => [m[1], m[2].trim()]),
    );
}

/** Body of `export const NAME = { ... } as const;` as { key: value }. */
function tsConstObject(name) {
    const match = ts.match(new RegExp(`export const ${name} = \\{([^}]*)\\} as const;`));
    if (!match) return null;
    return Object.fromEntries(
        [...match[1].matchAll(/^\s*(\w+): '([^']*)',/gm)].map((m) => [m[1], m[2]]),
    );
}

const paths = tsConstObject('PATHS') ?? {};
const seen = new Set();

for (const file of readdirSync(contractsDir).filter((f) => f.endsWith('.xml')).sort()) {
    const text = readFileSync(new URL(file, contractsDir), 'utf8');
    const doc = parser.parse(text);
    for (const iface of doc.node.interface ?? []) {
        const short = iface.name.replace(/^io\.nokta\./, '');
        const base = short.replace(/\d+$/, '');
        seen.add(short);

        const path = text.match(/Object path: (\/[\w/]+)\./)?.[1];
        if (paths[short] !== path) {
            errors.push(`${iface.name}: PATHS.${short} is ${paths[short]}, contract says ${path}`);
        }

        const props = tsInterface(`${base}Props`);
        if (!props) {
            errors.push(`${iface.name}: missing interface ${base}Props`);
        } else {
            const xmlProps = new Map((iface.property ?? []).map((p) => [p.name, p.type]));
            for (const [name, type] of xmlProps) {
                const want = TS_TYPE[type];
                if (!want) errors.push(`${iface.name}.${name}: no TypeScript mapping for "${type}"`);
                else if (!(name in props)) errors.push(`${base}Props: missing ${name}: ${want}`);
                else if (props[name] !== want) errors.push(`${base}Props.${name}: is ${props[name]}, contract says ${want}`);
            }
            for (const name of Object.keys(props)) {
                if (!xmlProps.has(name)) errors.push(`${base}Props.${name}: not in ${file}`);
            }
        }

        const methods = iface.method ?? [];
        const constName = `${base.toUpperCase()}_METHODS`;
        const tsMethods = tsConstObject(constName);
        if (methods.length > 0 && !tsMethods) {
            errors.push(`${iface.name}: missing ${constName}`);
        } else if (tsMethods) {
            const xmlMethods = new Map(
                methods.map((m) => [
                    m.name,
                    (m.arg ?? []).filter((a) => (a.direction ?? 'in') === 'in').map((a) => a.type).join(''),
                ]),
            );
            for (const [name, signature] of xmlMethods) {
                if (!(name in tsMethods)) errors.push(`${constName}: missing ${name}`);
                else if (tsMethods[name] !== signature) errors.push(`${constName}.${name}: is '${tsMethods[name]}', contract says '${signature}'`);
            }
            for (const name of Object.keys(tsMethods)) {
                if (!xmlMethods.has(name)) errors.push(`${constName}.${name}: not in ${file}`);
            }
        }
    }
}

for (const short of Object.keys(paths)) {
    if (!seen.has(short)) errors.push(`PATHS.${short}: no contract for io.nokta.${short}`);
}

if (errors.length > 0) {
    console.error(`check-contracts: src/shared/contracts.ts differs from contracts/*.xml\n  ${errors.join('\n  ')}`);
    process.exit(1);
}
console.log(`check-contracts: ${seen.size} interfaces match`);
