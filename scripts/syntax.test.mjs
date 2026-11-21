import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import textmate from "vscode-textmate";
import oniguruma from "vscode-oniguruma";

const require = createRequire(import.meta.url);
const wasm = await readFile(require.resolve("vscode-oniguruma/release/onig.wasm"));
await oniguruma.loadWASM(wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength));
const registry = new textmate.Registry({
    onigLib: Promise.resolve({
        createOnigScanner: patterns => new oniguruma.OnigScanner(patterns),
        createOnigString: value => new oniguruma.OnigString(value),
    }),
    loadGrammar: async scope => scope === "source.aside"
        ? textmate.parseRawGrammar(await readFile("syntaxes/aside.tmLanguage.json", "utf8"), "aside.tmLanguage.json")
        : null,
});
const grammar = await registry.loadGrammar("source.aside");
assert.ok(grammar);

function tokens(source) {
    let state = textmate.INITIAL;
    return source.split("\n").map(line => {
        const result = grammar.tokenizeLine(line, state);
        state = result.ruleStack;
        return result.tokens.map(token => ({ ...token, text: line.slice(token.startIndex, token.endIndex) }));
    });
}

function expectScope(line, value, scope) {
    const result = tokens(line)[0];
    const start = line.indexOf(value);
    assert.ok(start >= 0, `Missing fixture text: ${value}`);
    for (let index = start; index < start + value.length; index++) {
        const token = result.find(token => token.startIndex <= index && index < token.endIndex);
        assert.ok(token?.scopes.includes(scope), `${JSON.stringify(value)} needs ${scope}; got ${JSON.stringify(token)}`);
    }
}

test("incomplete declarations, ordinary variables and Unicode identifiers receive scopes", () => {
    for (const keyword of ["fn", "class", "enum"]) expectScope(keyword, keyword, "storage.type.aside");
    for (const name of ["value", "角色", "cafe\u0301", "𐐀名", "class·name", "class角色", "if_name", "type", "Map"]) {
        expectScope(`let ${name} = other;`, name, "variable.other.readwrite.aside");
    }
    expectScope("fn 计算(café: int) { café }", "计算", "entity.name.function.aside");
    expectScope("class 角色 {", "角色", "entity.name.type.aside");
    expectScope("pub enum 操作 {", "操作", "entity.name.type.aside");
    expectScope("pub type 状态 = {active: bool};", "状态", "entity.name.type.aside");
    expectScope("let value = class {};", "class", "storage.type.aside");
    expectScope("let callback: fn(int) -> int;", "fn", "storage.type.aside");
});

test("all language keywords, built-in annotations and literal forms are highlighted", () => {
    const groups = {
        "keyword.control.aside": "if else while for in loop match is await return break continue throw yield try catch finally",
        "storage.modifier.aside": "let mut async gen static pub use as",
        "storage.type.aside": "fn class enum any bool int float string array table tuple closure Future generator Bytes TextBuffer ByteBuffer Set Range Iterator AsyncIterator thread weakref instance Binding",
        "constant.language.aside": "true false null",
        "constant.numeric.aside": "0 42 1_000 0xff 0XFF 0b101 0B101 0o77 0O77 1.25 1e3 1.25e-3",
    };
    for (const [scope, values] of Object.entries(groups)) {
        for (const value of values.split(" ")) expectScope(value, value, scope);
    }
    expectScope("0..=10", "0", "constant.numeric.aside");
    expectScope("0..=10", "..=", "keyword.operator.aside");
    expectScope("0..=10", "10", "constant.numeric.aside");
});

test("members, optional calls, named arguments and every operator keep useful roles", () => {
    expectScope("player.积分", "积分", "variable.other.property.aside");
    expectScope("player?.show?()", "show", "entity.name.function.member.aside");
    expectScope("callback?()", "callback", "entity.name.function.aside");
    expectScope("text(value: score)", "value", "variable.parameter.aside");
    for (const operator of ["...", "..", "..=", "::", "->", "=>", "+", "-", "*", "/", "%", "!", "~", "&", "|", "^", "&&", "||", "??", "?.", "=", "==", "!=", "<", "<=", ">", ">=", "<<", ">>", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "<<=", ">>="]) {
        expectScope(operator, operator, "keyword.operator.aside");
    }
    for (const optional of ["?[", "?("]) expectScope(optional, "?", "keyword.operator.aside");
});

test("strings and nested comments isolate names and recover to code", () => {
    const lines = tokens("/* outer class\n/* inner let name */\nfn still_comment */ let visible = 1;");
    for (const line of lines.slice(0, 2)) {
        assert.ok(line.every(token => token.scopes.includes("comment.block.aside")));
    }
    assert.ok(lines[2].some(token => token.text === "visible" && token.scopes.includes("variable.other.readwrite.aside")));
    for (const source of ['"class name"', 'r"class name"', '"""class name"""', 'r"""class name"""', '// class name', '/// class name']) {
        const result = tokens(source)[0];
        assert.ok(result.every(token => !token.scopes.some(scope => scope.startsWith("variable.") || scope.startsWith("storage."))));
    }
    const multiline = tokens('"""first\nclass still_text\n""" let visible = 1;');
    assert.ok(multiline[1].every(token => token.scopes.includes("string.quoted.triple.aside")));
    assert.ok(multiline[2].some(token => token.text === "visible" && token.scopes.includes("variable.other.readwrite.aside")));
    expectScope(String.raw`"a\n\u{4E2D}\"b"`, String.raw`\n`, "constant.character.escape.aside");
    expectScope(String.raw`"a\q"`, String.raw`\q`, "invalid.illegal.escape.aside");
    assert.ok(!tokens(String.raw`r"a\n"`)[0].some(token => token.scopes.includes("constant.character.escape.aside")));
});

test("interpolated expressions expose code token types, including nested braces and strings", () => {
    const source = 'f"hello {{literal}} {({name: 角色}).name} {"nested"}"';
    expectScope(source, "角色", "variable.other.readwrite.aside");
    expectScope(source, "{{", "constant.character.escape.aside");
    expectScope(source, "nested", "string.quoted.double.aside");
    const result = grammar.tokenizeLine2(source, textmate.INITIAL).tokens;
    function tokenTypeAt(index) {
        let metadata;
        for (let offset = 0; offset < result.length && result[offset] <= index; offset += 2) metadata = result[offset + 1];
        return (metadata >>> 8) & 3;
    }
    assert.equal(tokenTypeAt(source.indexOf("hello")), 2);
    assert.equal(tokenTypeAt(source.indexOf("角色")), 0);
    assert.equal(tokenTypeAt(source.indexOf("nested")), 2);
    const multiline = tokens('f"""first\n{角色}\nlast"""');
    assert.ok(multiline[1].some(token => token.text === "角色" && token.scopes.includes("meta.embedded.expression.aside")));
});

test("editor word boundaries keep completion prefixes and Unicode names intact", async () => {
    const config = JSON.parse(await readFile("language-configuration.json", "utf8"));
    const { pattern, flags } = config.wordPattern;
    const words = [..."tex 角色.积分 café::𐐀名 callback?() 0xff 1.25e-3".matchAll(new RegExp(pattern, flags))].map(match => match[0]);
    assert.deepEqual(words, ["tex", "角色", "积分", "café", "𐐀名", "callback", "0xff", "1.25e-3"]);
});

test("indentation recognizes blocks after URL and raw strings", async () => {
    const config = JSON.parse(await readFile("language-configuration.json", "utf8"));
    const increase = new RegExp(config.indentationRules.increaseIndentPattern);
    const decrease = new RegExp(config.indentationRules.decreaseIndentPattern);
    for (const source of ["fn main() {", 'let url = "https://example.test"; if ready {', String.raw`let path = r"a\"; if ready {`, "call(", "let items = ["]) {
        assert.ok(increase.test(source), source);
    }
    for (const source of ["// comment {", 'let message = "{";', "fn main() {}", "call()", "let items = [];"]) {
        assert.ok(!increase.test(source), source);
    }
    assert.ok(!increase.test(`let message = ${Array(256).fill('r"plain"').join(" + ")};`));
    for (const source of ["}", "    ]", "    )"]) assert.ok(decrease.test(source), source);
});
