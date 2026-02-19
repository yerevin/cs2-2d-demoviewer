const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

try {
  const goRoot = execSync('go env GOROOT').toString().trim();
  const candidates = [
    path.join(goRoot, 'lib', 'wasm', 'wasm_exec.js'),
    path.join(goRoot, 'misc', 'wasm', 'wasm_exec.js'),
  ];

  const wasmExec = candidates.find((p) => fs.existsSync(p));
  if (!wasmExec) fail('wasm_exec.js not found in GOROOT (check your Go installation)');

  const outDir = path.join(process.cwd(), 'public', 'parser');
  fs.mkdirSync(outDir, { recursive: true });
  fs.copyFileSync(wasmExec, path.join(outDir, 'wasm_exec.js'));
  console.log('Copied wasm_exec.js ->', path.join('public', 'parser', 'wasm_exec.js'));

  console.log('Building Go WASM (GOOS=js GOARCH=wasm)...');
  const env = Object.assign({}, process.env, { GOOS: 'js', GOARCH: 'wasm' });
  execSync('go build -o public/parser/cs2parser.wasm .', { stdio: 'inherit', env });
  console.log('Built public/parser/cs2parser.wasm');
} catch (err) {
  console.error(err && err.message ? err.message : err);
  process.exit(1);
}
