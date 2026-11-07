// Working out whether a newer version is out and how to put it in place. The
// Electron side, which downloads it and restarts the app, is in updater.js.
// Windows only, like the app's builds, so paths are always Windows paths.

const path = require('node:path').win32;

const REPO = 'mikep49/compare';
const LATEST_RELEASE = `https://api.github.com/repos/${REPO}/releases/latest`;
const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`;

// The release files each way of running the app updates itself from.
const ASSETS = {
  installed: /^Compare-Setup-.+\.exe$/i,
  portable: /^Compare-Portable-.+\.exe$/i,
};

// '1.2.0' or 'v1.2.0' as [1, 2, 0]; null for anything else, pre-releases
// included.
function parseVersion(text) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(text ?? '').trim());
  return match ? match.slice(1).map(Number) : null;
}

function isNewer(latest, current) {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  if (!a || !b) return false;
  const i = a.findIndex((part, index) => part !== b[index]);
  return i >= 0 && a[i] > b[i];
}

// How this copy of the app runs: 'portable' for the portable exe, which
// unpacks itself to a temporary folder and says where it really is in
// PORTABLE_EXECUTABLE_FILE; 'installed' for a copy the installer put in place
// with its uninstaller; 'manual' for the rest, such as the zip build, which
// is updated by downloading the new version by hand. `exists` checks a path.
function installKind({ env, execPath, exists }) {
  if (env.PORTABLE_EXECUTABLE_FILE) return 'portable';
  if (exists(path.join(path.dirname(execPath), 'Uninstall Compare.exe'))) return 'installed';
  return 'manual';
}

// GitHub's answer about the latest release as { version, page, assets }, each
// asset { name, size, url, sha256 }; null when it isn't a usable release.
// GitHub gives the SHA-256 checksum of files uploaded since mid-2025.
function readRelease(json) {
  if (!json || json.draft || json.prerelease || !parseVersion(json.tag_name)) return null;
  return {
    version: parseVersion(json.tag_name).join('.'),
    page: typeof json.html_url === 'string' && json.html_url.startsWith('https://github.com/') ? json.html_url : RELEASES_PAGE,
    assets: (json.assets ?? []).map((asset) => ({
      name: asset.name,
      size: asset.size,
      url: asset.browser_download_url,
      sha256: /^sha256:[0-9a-f]{64}$/i.test(asset.digest ?? '') ? asset.digest.slice(7).toLowerCase() : null,
    })),
  };
}

// The file a copy run as `kind` updates itself from, or null when there is
// none (then the button opens the release page instead).
function findAsset(release, kind) {
  const pattern = ASSETS[kind];
  if (!pattern) return null;
  return (
    release.assets.find(
      (asset) => pattern.test(asset.name) && Number.isFinite(asset.size) && /^https:\/\/github\.com\//.test(asset.url ?? '')
    ) ?? null
  );
}

// Where the new portable exe goes. A copy still named after its version, as
// it was downloaded, takes the name of the new version; one the user renamed
// keeps its name, so shortcuts to it go on working.
function portableTarget(currentFile, currentVersion, assetName) {
  const name = path.basename(currentFile);
  const asDownloaded = `Compare-Portable-${currentVersion}.exe`;
  return path.join(path.dirname(currentFile), name.toLowerCase() === asDownloaded.toLowerCase() ? assetName : name);
}

// What a new portable exe is called while it is being downloaded, next to
// the one it replaces. Left-over ones are cleared away at the next start.
const PARTIAL = '.compare-update';

// Puts a downloaded portable exe in place once the old one has closed. The
// old exe stays locked until the portable launcher has cleaned up after the
// app, a moment after it quit, so each step is tried again until it works.
// Then, when COMPARE_UPDATE_START is set, it starts the new version.
const SWAP_SCRIPT = `$download = $env:COMPARE_UPDATE_DOWNLOAD
$target = $env:COMPARE_UPDATE_TARGET
$old = $env:COMPARE_UPDATE_OLD
$start = $env:COMPARE_UPDATE_START -eq '1'
Remove-Item Env:COMPARE_UPDATE_*
$deadline = (Get-Date).AddMinutes(2)
function Retry([scriptblock]$Step) {
  while ($true) {
    try { & $Step; return $true }
    catch { if ((Get-Date) -gt $deadline) { return $false }; Start-Sleep -Milliseconds 250 }
  }
}
$moved = Retry { Move-Item -LiteralPath $download -Destination $target -Force -ErrorAction Stop }
if ($moved -and $old -ne $target) { Retry { Remove-Item -LiteralPath $old -Force -ErrorAction Stop } | Out-Null }
if ($start) {
  $app = if ($moved) { $target } else { $old }
  Start-Process -FilePath $app -WorkingDirectory (Split-Path -LiteralPath $app)
}
`;

const encode = (script) => Buffer.from(script, 'utf16le').toString('base64');

// How to run the swap script so that it outlives the app: as { args, env }
// for PowerShell at `powershell`, to be waited for before the app quits.
// Started straight from the app, PowerShell either goes when the app does
// (Node ties its child processes to it) or, detached, has no console and
// quits at once. So this PowerShell starts another, hidden, which is free of
// the app, and is done once it has. The paths go in environment variables,
// so no quoting can trip over them.
function swapLaunch({ powershell, download, target, old, start }) {
  const quoted = `'${powershell.replace(/'/g, "''")}'`;
  const options = "'-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand'";
  const outer = `Start-Process -FilePath ${quoted} -WindowStyle Hidden -ArgumentList ${options},'${encode(SWAP_SCRIPT)}'`;
  return {
    args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encode(outer)],
    env: {
      COMPARE_UPDATE_DOWNLOAD: download,
      COMPARE_UPDATE_TARGET: target,
      COMPARE_UPDATE_OLD: old,
      COMPARE_UPDATE_START: start ? '1' : '0',
    },
  };
}

module.exports = {
  LATEST_RELEASE,
  RELEASES_PAGE,
  PARTIAL,
  swapLaunch,
  parseVersion,
  isNewer,
  installKind,
  readRelease,
  findAsset,
  portableTarget,
};
