#!/usr/bin/env node
/**
 * Shai-Hulud npm supply chain attack scanner
 * Independent version (no glob, no external deps)
 */

import { assert } from 'console';
import fs from 'fs';
import path from 'path';

// === Curated known-bad list (from Wiz + JFrog reports) ===
const KNOWN_BAD = new Set([
  '@ctrl/tinycolor',
  '@ctrl/deluge',
  '@ctrl/transmission',
  'encounter-playground',
  'snow-package-manager',
  'ok-verify',
  'polar-ssl-cert',
  'gpt-turbo-vision',
  '@ctrl/deluge',
  '@ctrl/golang-template',
  '@ctrl/magnet-link',
  '@ctrl/ngx-codemirror',
  '@ctrl/ngx-csv',
  '@ctrl/ngx-emoji-mart',
  '@ctrl/ngx-rightclick',
  '@ctrl/qbittorrent',
  '@ctrl/react-adsense',
  '@ctrl/shared-torrent',
  '@ctrl/tinycolor',
  '@ctrl/torrent-file',
  '@ctrl/transmission',
  '@ctrl/ts-base32',
  '@nativescript-community/gesturehandler',
  '@nativescript-community/sentry',
  '@nativescript-community/text',
  '@nativescript-community/ui-collectionview',
  '@nativescript-community/ui-drawer',
  '@nativescript-community/ui-image',
  '@nativescript-community/ui-material-bottomsheet',
  '@nativescript-community/ui-material-core',
  '@nativescript-community/ui-material-core-tabs',
  '@teselagen/bio-parsers',
  '@teselagen/bounce-loader',
  '@teselagen/file-utils',
  '@teselagen/liquibase-tools',
  '@teselagen/ove',
  '@teselagen/range-utils',
  '@teselagen/react-list',
  '@teselagen/react-table',
  '@teselagen/sequence-utils',
  '@teselagen/ui',
  'angulartics2',
  'encounter-playground',
  'eslint-config-teselagen',
  'graphql-sequelize-teselagen',
  'json-rules-engine-simplified',
  'koa2-swagger-ui',
  'ng2-file-upload',
  'ngx-bootstrap',
  'ngx-color',
  'ngx-toastr',
  'ngx-trend',
  'oradm-to-gql',
  'oradm-to-sqlz',
  'ove-auto-annotate',
  'react-complaint-image',
  'react-jsonschema-form-conditionals',
  'react-jsonschema-form-extras',
  'react-jsonschema-rxnt-extras',
  'rxnt-authentication',
  'rxnt-healthchecks-nestjs',
  'rxnt-kue',
  'swc-plugin-component-annotate',
  'tg-client-query-builder',
  'tg-redbird',
  'tg-seq-gen',
  'ts-gaussian',
  've-bamreader',
  've-editor',
  '@ahmedhfarag/ngx-perfect-scrollbar',
  '@ahmedhfarag/ngx-virtual-scroller',
  '@art-ws/common',
  '@art-ws/config-eslint',
  '@art-ws/config-ts',
  '@art-ws/db-context',
  '@art-ws/di-node',
  '@art-ws/di',
  '@art-ws/eslint',
  '@art-ws/fastify-http-server',
  '@art-ws/http-server',
  '@art-ws/openapi',
  '@art-ws/package-base',
  '@art-ws/prettier',
  '@art-ws/slf',
  '@art-ws/ssl-info',
  '@art-ws/web-app',
  '@crowdstrike/commitlint',
  '@crowdstrike/falcon-shoelace',
  '@crowdstrike/foundry-js',
  '@crowdstrike/glide-core',
  '@crowdstrike/logscale-dashboard',
  '@crowdstrike/logscale-file-editor',
  '@crowdstrike/logscale-parser-edit',
  '@crowdstrike/logscale-search',
  '@crowdstrike/tailwind-toucan-base',
  '@hestjs/core',
  '@hestjs/cqrs',
  '@hestjs/demo',
  '@hestjs/eslint-config',
  '@hestjs/logger',
  '@hestjs/scalar',
  '@hestjs/validation',
  '@nativescript-community/arraybuffers',
  '@nativescript-community/perms',
  '@nativescript-community/sqlite',
  '@nativescript-community/typeorm',
  '@nativescript-community/ui-document-picker',
  '@nativescript-community/ui-label',
  '@nativescript-community/ui-material-bottom-navigation',
  '@nativescript-community/ui-material-ripple',
  '@nativescript-community/ui-material-tabs',
  '@nativescript-community/ui-pager',
  '@nativescript-community/ui-pulltorefresh',
  '@nexe/config-manager',
  '@nexe/eslint-config',
  '@nexe/logger',
  '@nstudio/angular',
  '@nstudio/focus',
  '@nstudio/nativescript-checkbox',
  '@nstudio/nativescript-loading-indicator',
  '@nstudio/ui-collectionview',
  '@nstudio/web-angular',
  '@nstudio/web',
  '@nstudio/xplat-utils',
  '@nstudio/xplat',
  '@operato/board',
  '@operato/data-grist',
  '@operato/graphql',
  '@operato/headroom',
  '@operato/help',
  '@operato/i18n',
  '@operato/input',
  '@operato/layout',
  '@operato/popup',
  '@operato/pull-to-refresh',
  '@operato/shell',
  '@operato/styles',
  '@operato/utils',
  '@thangved/callback-window',
  '@things-factory/attachment-base',
  '@things-factory/auth-base',
  '@things-factory/email-base',
  '@things-factory/env',
  '@things-factory/integration-base',
  '@things-factory/integration-marketplace',
  '@things-factory/shell',
  '@tnf-dev/api',
  '@tnf-dev/core',
  '@tnf-dev/js',
  '@tnf-dev/mui',
  '@tnf-dev/react',
  '@ui-ux-gang/devextreme-angular-rpk',
  '@yoobic/design-system',
  '@yoobic/jpeg-camera-es6',
  '@yoobic/yobi',
  'airchief',
  'airpilot',
  'browser-webdriver-downloader',
  'capacitor-notificationhandler',
  'capacitor-plugin-healthapp',
  'capacitor-plugin-ihealth',
  'capacitor-plugin-vonage',
  'capacitorandroidpermissions',
  'config-cordova',
  'cordova-plugin-voxeet2',
  'cordova-voxeet',
  'create-hest-app',
  'db-evo',
  'devextreme-angular-rpk',
  'ember-browser-services',
  'ember-headless-form-yup',
  'ember-headless-form',
  'ember-headless-table',
  'ember-url-hash-polyfill',
  'ember-velcro',
  'eslint-config-crowdstrike-node',
  'eslint-config-crowdstrike',
  'globalize-rpk',
  'html-to-base64-image',
  'jumpgate',
  'mcfly-semantic-release',
  'mcp-knowledge-base',
  'mcp-knowledge-graph',
  'mobioffice-cli',
  'monorepo-next',
  'mstate-angular',
  'mstate-cli',
  'mstate-dev-react',
  'mstate-react',
  'ngx-ws',
  'pm2-gelf-json',
  'printjs-rpk',
  'remark-preset-lint-crowdstrike',
  'tbssnch',
  'teselagen-interval-tree',
  'thangved-react-grid',
  'ts-imports',
  'tvi-cli',
  'verror-extra',
  'voip-callkit',
  'wdio-web-reporter',
  'yargs-help-output',
  'yoo-styles',
  'devextreme-rpk',
  '@basic-ui-components-stc/basic-ui-components',
]);

// === Postinstall scripts that are normal / expected ===
const SAFE_POSTINSTALL = new Set(['esbuild', 'puppeteer', 'husky', 'core-js', 'electron']);

function readJSON(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function scanPackageJson(root) {
  const file = path.join(root, 'package.json');

  if (!fs.existsSync(file)) return [];

  const pkg = readJSON(file);
  if (!pkg) return [];

  const deps = Object.assign({}, pkg.dependencies, pkg.devDependencies);
  return Object.keys(deps || {}).filter((d) => KNOWN_BAD.has(d));
}

function scanYarnLock(root) {
  const file = path.join(root, 'yarn.lock');
  if (!fs.existsSync(file)) return [];

  const content = fs.readFileSync(file, 'utf8');
  return [...KNOWN_BAD].filter((bad) => content.includes(bad));
}

// Recursive directory walker to find package.json files
function walkDir(dir, found = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return found;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      // Skip nested node_modules inside node_modules (perf boost)
      if (entry.name === 'node_modules' && fullPath !== dir) continue;
      walkDir(fullPath, found);
    } else if (entry.isFile() && entry.name === 'package.json') {
      found.push(fullPath);
    }
  }

  return found;
}

function scanNodeModules(root) {
  const results = [];
  const nm = path.join(root, 'node_modules');
  if (!fs.existsSync(nm)) return results;

  const pkgFiles = walkDir(nm);

  for (const file of pkgFiles) {
    const pkg = readJSON(file);
    if (!pkg) continue;

    const name = pkg.name;
    const hasPostinstall = pkg.scripts && pkg.scripts.postinstall;

    // Known bad package
    if (KNOWN_BAD.has(name)) {
      results.push({ name, type: 'KNOWN_BAD' });
    }

    // Suspicious postinstall
    if (hasPostinstall && !SAFE_POSTINSTALL.has(name)) {
      results.push({
        name,
        type: 'SUSPICIOUS_POSTINSTALL',
        script: pkg.scripts.postinstall,
        file,
        pkg,
      });
    }
  }

  return results;
}

function main() {
  const root = process.cwd();
  const badPkgs = scanPackageJson(root);
  const badLock = scanYarnLock(root);
  const nmFindings = scanNodeModules(root);
  let foundIssues = 0;

  console.log('\n==== SHAI-HULUD SCAN RESULTS ====\n');

  if (badPkgs.length === 0 && badLock.length === 0 && nmFindings.length === 0) {
    console.log('✅ No compromised packages found.\n');
    return;
  }

  if (badPkgs.length > 0) {
    console.log('⚠️ Found in package.json:', badPkgs.join(', '));
    foundIssues++;
  }

  if (badLock.length > 0) {
    console.log('⚠️ Found in yarn.lock:', badLock.join(', '));
    foundIssues++;
  }

  if (nmFindings.length > 0) {
    console.log('⚠️ Issues in node_modules:');
    for (const f of nmFindings) {
      if (f.type === 'KNOWN_BAD') {
        console.log(`   - 🚨 ${f.name} (known compromised)`);
        foundIssues++;
      } else {
        console.log(f);
        console.log(`   - ⚠️ ${f.name} has postinstall -> ${f.script}`);
      }
    }
  }
  try {
    assert(foundIssues > 0);
  } catch (error) {
    process.exit(1);
  }
}

main();
