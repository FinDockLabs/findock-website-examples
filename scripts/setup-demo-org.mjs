// Sets up a Salesforce org for the Lightning Out examples: one org that runs every example, with the flows and
// styles deployed from the payment experiences templates (source, not packages) and the Lightning Out site, app
// and wrappers from this repository.
//
//   cp scripts/demo-org.config.example.json scripts/demo-org.config.json   # then fill it in
//   node scripts/setup-demo-org.mjs [path/to/config.json] [--dry-run] [--update-site]
//
//   --dry-run      validate every deploy without saving it; skip installs, publishing and data changes
//   --update-site  overwrite an existing Lightning Out site from salesforce/lightning-out-site
//
// Each step checks the org first, so the script can run again after a failure or to pick up changes.
// See salesforce/README.md, "Set up a demo org with the script".
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE_NAME = 'Lightning Out'; // Network name
const SITE_RECORD = 'Lightning_Out'; // Site record that owns the guest user
const LWR_SITE_RECORD = 'Lightning_Out1'; // Site record of the LWR site (framing settings)
const SITE_PREFIX = 'lightningout';
const LO_APP = 'Lightning_Out_App';
const API_VERSION = '68.0'; // LightningOutApp needs 68 or later

// ---------- config ----------

const DRY_RUN = process.argv.includes('--dry-run');
const configArg = process.argv.slice(2).find((arg) => !arg.startsWith('--'));
const configPath = resolve(configArg ?? join(root, 'scripts/demo-org.config.json'));
if (!existsSync(configPath)) {
    fail(`No config at ${configPath}. Copy scripts/demo-org.config.example.json to scripts/demo-org.config.json and fill it in.`);
}
const config = JSON.parse(readFileSync(configPath, 'utf8'));
const org = config.targetOrg;
// Relative to this repository, e.g. ../payment-experiences-templates for a clone next to it.
const templatesRepo = resolve(root, config.templatesRepo ?? '../payment-experiences-templates');
const donationTemplate = config.donationTemplate ?? 'donation-npsp';
const websites = (config.websites ?? []).map((url) => new URL(url).origin);
const packagesDir = join(templatesRepo, 'sfdx-source/packages');

if (!org) fail('Set targetOrg in the config: the sf alias of the org.');
if (!existsSync(packagesDir)) fail(`templatesRepo doesn't point at payment-experiences-templates: ${packagesDir} not found.`);
if (!existsSync(join(packagesDir, donationTemplate))) fail(`donationTemplate ${donationTemplate} not found in ${packagesDir}.`);
if (!websites.length) fail('Add the websites that embed the flows to "websites" in the config.');

// ---------- helpers ----------

function fail(message) {
    console.error(`\n✖ ${message}`);
    process.exit(1);
}

function step(title) {
    console.log(`\n==> ${title}`);
}

/** Runs an sf command with --json and returns its result; stops the script when it fails unless allowFailure. */
function sf(args, { cwd = root, allowFailure = false } = {}) {
    const run = spawnSync('sf', [...args, '--json'], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    let output;
    try {
        output = JSON.parse(run.stdout);
    } catch {
        output = { status: run.status ?? 1, message: (run.stderr || run.stdout || '').trim() };
    }
    if (output.status !== 0 && !allowFailure) {
        const failures = [output.result?.details?.componentFailures ?? []].flat()
            .map((f) => `   ${f.componentType} ${f.fullName}: ${f.problem}`);
        fail([`sf ${args.slice(0, 3).join(' ')} failed: ${output.message ?? ''}`, ...failures].join('\n'));
    }
    return output;
}

function query(soql, { tooling = false } = {}) {
    const args = ['data', 'query', '-o', org, '-q', soql];
    if (tooling) args.push('--use-tooling-api');
    return sf(args).result.records;
}

function deploy(paths, { cwd = root, label } = {}) {
    const args = ['project', 'deploy', 'start', '-o', org, '--wait', '60', '--ignore-conflicts', '--api-version', API_VERSION];
    for (const path of paths) args.push('-d', path);
    if (DRY_RUN) args.push('--dry-run');
    const result = sf(args, { cwd }).result;
    console.log(`   - ${label ?? paths.join(', ')}: ${result.numberComponentsDeployed ?? '?'} components${DRY_RUN ? ' (validated only)' : ''}`);
}

/** A throwaway sfdx project to deploy generated metadata from. */
function tempProject() {
    const dir = mkdtempSync(join(tmpdir(), 'lo-demo-'));
    writeFileSync(join(dir, 'sfdx-project.json'), JSON.stringify({
        packageDirectories: [{ path: 'force-app', default: true }],
        sourceApiVersion: API_VERSION,
    }));
    return dir;
}

function siteName(origin) {
    return new URL(origin).hostname.replace(/^\*\./, '').split('.')[0].replace(/[^A-Za-z0-9]+/g, ' ').trim() || 'Website';
}

function apiName(origin) {
    return origin.replace(/^https?:\/\//, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 70);
}

// ---------- 1. org ----------

step(`Checking org ${org}`);
const orgInfo = sf(['org', 'display', '-o', org]).result;
console.log(`   - ${orgInfo.username} on ${orgInfo.instanceUrl}`);
const installed = sf(['package', 'installed', 'list', '-o', org]).result;
const installedNamespaces = new Set(installed.map((p) => p.SubscriberPackageNamespace).filter(Boolean));

// ---------- 2. org settings ----------

step('Org settings: Chatter, Digital Experiences, ExperienceBundle metadata, Lightning Out framing, CORS and CSP');
{
    const dir = tempProject();
    const base = join(dir, 'force-app/main/default');
    const write = (path, xml) => {
        const file = join(base, path);
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, `<?xml version="1.0" encoding="UTF-8"?>\n${xml}\n`);
    };
    // Chatter is off in orgs from the Nonprofit Cloud Trialforce template; the Lightning Out site needs it.
    write('settings/Chatter.settings-meta.xml',
        '<ChatterSettings xmlns="http://soap.sforce.com/2006/04/metadata">\n    <enableChatter>true</enableChatter>\n</ChatterSettings>');
    write('settings/Communities.settings-meta.xml',
        '<CommunitiesSettings xmlns="http://soap.sforce.com/2006/04/metadata">\n    <enableNetworksEnabled>true</enableNetworksEnabled>\n</CommunitiesSettings>');
    write('settings/ExperienceBundle.settings-meta.xml',
        '<ExperienceBundleSettings xmlns="http://soap.sforce.com/2006/04/metadata">\n    <enableExperienceBundleMetadata>true</enableExperienceBundleMetadata>\n</ExperienceBundleSettings>');
    write('iframeWhiteListUrlSettings/IframeWhiteListUrlSettings.iframeWhiteListUrlSettings-meta.xml',
        `<IframeWhiteListUrlSettings xmlns="http://soap.sforce.com/2006/04/metadata">\n${websites.map((url) =>
            `    <iframeWhiteListUrls>\n        <context>LightningOut</context>\n        <url>${url}</url>\n    </iframeWhiteListUrls>`).join('\n')}\n</IframeWhiteListUrlSettings>`);
    // An origin can be trusted only once; keep entries the org already has (under any name).
    const corsTrusted = new Set(query('SELECT UrlPattern FROM CorsWhitelistEntry').map((r) => r.UrlPattern));
    const cspTrusted = new Set(query('SELECT EndpointUrl FROM CspTrustedSite', { tooling: true }).map((r) => r.EndpointUrl));
    for (const url of websites) {
        const name = `LightningOut_${apiName(url)}`;
        if (corsTrusted.has(url)) console.log(`   - CORS: ${url} already allowed`);
        else write(`corsWhitelistOrigins/${name}.corsWhitelistOrigin-meta.xml`,
            `<CorsWhitelistOrigin xmlns="http://soap.sforce.com/2006/04/metadata">\n    <urlPattern>${url}</urlPattern>\n</CorsWhitelistOrigin>`);
        if (cspTrusted.has(url)) console.log(`   - CSP: ${url} already trusted`);
        else write(`cspTrustedSites/${name}.cspTrustedSite-meta.xml`,
            `<CspTrustedSite xmlns="http://soap.sforce.com/2006/04/metadata">\n    <canAccessCamera>false</canAccessCamera>\n    <canAccessMicrophone>false</canAccessMicrophone>\n    <context>All</context>\n    <endpointUrl>${url}</endpointUrl>\n    <isActive>true</isActive>\n    <isApplicableToConnectSrc>true</isApplicableToConnectSrc>\n    <isApplicableToFontSrc>true</isApplicableToFontSrc>\n    <isApplicableToFrameSrc>true</isApplicableToFrameSrc>\n    <isApplicableToImgSrc>true</isApplicableToImgSrc>\n    <isApplicableToMediaSrc>true</isApplicableToMediaSrc>\n    <isApplicableToStyleSrc>true</isApplicableToStyleSrc>\n</CspTrustedSite>`);
    }
    deploy(['force-app'], { cwd: dir, label: `settings, ${websites.length} website(s) trusted` });
    rmSync(dir, { recursive: true, force: true });
}

// ---------- 3. packages ----------

step('Packages');
{
    const needed = (config.packages ?? []).filter((p) => !p.for || [p.for].flat().includes(donationTemplate));
    const missing = [];
    for (const pkg of needed) {
        if (installedNamespaces.has(pkg.namespace)) {
            console.log(`   - ${pkg.name} installed`);
            continue;
        }
        if (!pkg.versionId) {
            missing.push(pkg);
            continue;
        }
        if (DRY_RUN) {
            console.log(`   - would install ${pkg.name}`);
            continue;
        }
        console.log(`   - installing ${pkg.name} (this can take a while)`);
        const args = ['package', 'install', '-o', org, '-p', pkg.versionId, '-w', '90', '-r', '-s', 'AdminsOnly'];
        if (pkg.installationKey) args.push('-k', pkg.installationKey);
        sf(args);
        installedNamespaces.add(pkg.namespace);
    }
    if (missing.length) {
        fail(`Not installed and no versionId in the config:\n${missing.map((p) => `   ${p.name} (${p.namespace})`).join('\n')}\n` +
            '   Install them from their install links, or add the package version Ids (04t...) to the config, and run again.');
    }
}

// ---------- 4. templates ----------

step(`Payment experience templates from ${templatesRepo}`);
// From source, so the components the Checkout and donation templates share are deployed once.
deploy(['checkout', donationTemplate, 'pay-link'].map((folder) => `sfdx-source/packages/${folder}`),
    { cwd: templatesRepo, label: `checkout, ${donationTemplate}, pay-link` });
// Only the stylesheets, logos and icons of the site templates (the sites themselves aren't needed).
deploy(['checkout-site', 'donation-site'].map((folder) => `sfdx-source/packages/${folder}/staticresources`),
    { cwd: templatesRepo, label: 'site template styles, logos and icons' });

// ---------- 5. Lightning Out site ----------

step(`Lightning Out site (/${SITE_PREFIX})`);
const existingSite = query(`SELECT Id FROM Network WHERE Name = '${SITE_NAME}'`);
if (existingSite.length && !process.argv.includes('--update-site')) {
    console.log(`   - '${SITE_NAME}' exists: kept as it is (pass --update-site to overwrite it from salesforce/lightning-out-site)`);
} else {
    const dir = tempProject();
    const base = join(dir, 'force-app/main/default');
    cpSync(join(root, 'salesforce/lightning-out-site'), base, { recursive: true });
    const lwr = join(base, 'digitalExperiences/site/Lightning_Out1');
    for (const [path, key] of [
        ['sfdc_cms__trustedDomainsForInlineFrames/MCDLHITUW3BJBULDIYFSFU2FJGIY/content.json', 'trustedDomainsForInlineFrames'],
        ['sfdc_cms__trustedSites/trustedSites/content.json', 'trustedSites'],
    ]) {
        const file = join(lwr, path);
        const content = JSON.parse(readFileSync(file, 'utf8'));
        const [template] = content.contentBody[key];
        content.contentBody[key] = websites.map((url) => JSON.parse(JSON.stringify(template)
            .replaceAll('{{WEBSITE_ORIGIN}}', key === 'trustedDomainsForInlineFrames' ? `${url}/` : url)
            .replaceAll('{{WEBSITE_NAME}}', siteName(url))));
        writeFileSync(file, JSON.stringify(content, null, 2));
    }
    deploy(['force-app'], { cwd: dir, label: 'site' });
    rmSync(dir, { recursive: true, force: true });
}

// ---------- 6. wrappers and Lightning Out app ----------

step('Wrapper components and the Lightning Out app');
{
    const dir = tempProject();
    const base = join(dir, 'force-app/main/default');
    cpSync(join(root, 'salesforce/force-app/main/default/lwc'), join(base, 'lwc'), { recursive: true });
    cpSync(join(root, 'salesforce/force-app/main/default/lightningOutApps'), join(base, 'lightningOutApps'), { recursive: true });
    const appFile = join(base, 'lightningOutApps/Lightning_Out_App.lightningOutApp-meta.xml');
    let app = readFileSync(appFile, 'utf8');
    if (donationTemplate !== 'donation-npsp' && !app.includes('c-transaction-fee-opt-in')) {
        app = app.replace('    </components>',
            '        <component>\n            <componentName>c-transaction-fee-opt-in</componentName>\n        </component>\n    </components>');
    }
    writeFileSync(appFile, app);
    if (DRY_RUN) {
        // The app lists template components that a dry run only validated, so the org doesn't have them yet.
        rmSync(join(base, 'lightningOutApps'), { recursive: true, force: true });
        console.log('   - the Lightning Out app is checked in a real run, after the templates are deployed');
    }
    deploy(['force-app'], { cwd: dir, label: DRY_RUN ? 'wrappers' : 'wrappers and app' });
    rmSync(dir, { recursive: true, force: true });
}

// ---------- 7. publish ----------

step(`Publishing '${SITE_NAME}'`);
if (DRY_RUN) {
    console.log('   - skipped (dry run)');
} else {
    sf(['community', 'publish', '-o', org, '--name', SITE_NAME]);
    console.log('   - publish started (takes a minute or two)');
}

// ---------- 8. guest user ----------

step('Guest user permissions');
{
    const [site] = query(`SELECT GuestUserId FROM Site WHERE Name = '${SITE_RECORD}'`);
    if (!site?.GuestUserId && DRY_RUN) {
        console.log('   - skipped: the site doesn\'t exist yet (dry run)');
    }
    if (!site?.GuestUserId && !DRY_RUN) fail(`No guest user found for site ${SITE_RECORD}.`);
    const guest = site?.GuestUserId;
    const assigned = !guest ? new Set() : new Set(query(`SELECT PermissionSetId, PermissionSetGroupId FROM PermissionSetAssignment WHERE AssigneeId = '${guest}'`)
        .flatMap((a) => [a.PermissionSetId, a.PermissionSetGroupId]).filter(Boolean));
    const assign = (label, field, id) => {
        if (!id) return console.log(`   ! ${label} not found in the org, skipped`);
        if (assigned.has(id)) return console.log(`   - ${label} already assigned`);
        if (DRY_RUN) return console.log(`   - would assign ${label}`);
        sf(['data', 'create', 'record', '-o', org, '-s', 'PermissionSetAssignment', '-v', `AssigneeId=${guest} ${field}=${id}`]);
        console.log(`   - ${label} assigned`);
    };
    if (guest) {
        const [payer] = query("SELECT Id FROM PermissionSetGroup WHERE DeveloperName = 'FinDock_Payer'");
        assign('FinDock Payer (permission set group)', 'PermissionSetGroupId', payer?.Id);
        for (const [ns, name] of [
            ['cpm', 'FinDock_Core_Experience_Cloud_Run'],
            [null, 'FinDockLabs_Checkout_Flow_Guest_Access'],
            [null, 'FinDockLabs_Donation_Flow_Guest_Access'],
            [null, 'FinDockLabs_Pay_Link_Flow_Guest_Access'],
        ]) {
            const [ps] = query(`SELECT Id FROM PermissionSet WHERE Name = '${name}' AND NamespacePrefix = ${ns ? `'${ns}'` : 'null'}`);
            assign(ns ? `${ns}__${name}` : name, 'PermissionSetId', ps?.Id);
        }
        // Visitors run as the guest user, so its locale sets the number and date formats on the websites.
        // The language must be one the org offers (often only en_US for English); the locale can be any.
        if (config.guestLocale || config.guestLanguage) {
            const [user] = query(`SELECT LocaleSidKey, LanguageLocaleKey FROM User WHERE Id = '${guest}'`);
            const locale = config.guestLocale ?? user.LocaleSidKey;
            const language = config.guestLanguage ?? user.LanguageLocaleKey;
            const wanted = `locale ${locale}, language ${language}`;
            if (user.LocaleSidKey === locale && user.LanguageLocaleKey === language) {
                console.log(`   - guest ${wanted} already`);
            } else if (DRY_RUN) {
                console.log(`   - would set the guest ${wanted}`);
            } else {
                sf(['data', 'update', 'record', '-o', org, '-s', 'User', '-i', guest, '-v',
                    `LocaleSidKey=${locale} LanguageLocaleKey=${language}`]);
                console.log(`   - guest ${wanted} set`);
            }
        }
    }
}

// ---------- 9. link the app to the site ----------

step('Linking the Lightning Out app to the site');
const [appRecord] = query(`SELECT Id FROM LightningOutApp WHERE DeveloperName = '${LO_APP}'`, { tooling: true });
const [lwrSite] = query(`SELECT Id, ClickjackProtectionLevel FROM Site WHERE Name = '${LWR_SITE_RECORD}'`);
if ((!appRecord || !lwrSite) && DRY_RUN) {
    console.log('   - skipped: the app or site doesn\'t exist yet (dry run)');
    process.exit(0);
}
if (!appRecord || !lwrSite) fail('Lightning Out app or LWR site record not found.');
if (query(`SELECT Id FROM LightningOutAppDeployment WHERE LightningOutAppId = '${appRecord.Id}'`, { tooling: true }).length) {
    console.log('   - already linked');
} else if (DRY_RUN) {
    console.log('   - would link');
} else {
    const link = sf(['data', 'create', 'record', '-o', org, '--use-tooling-api', '-s', 'LightningOutAppDeployment', '-v',
        `LightningOutAppId=${appRecord.Id} DeveloperName=LightningOutAppDeployment_${appRecord.Id}_${lwrSite.Id.slice(0, 15)} ` +
        "MasterLabel=LightningOutAppDeployment ApplicationName='Lightning Out App' Status=CREATED IsGuestMode=false"],
    { allowFailure: true });
    console.log(link.status === 0 ? '   - linked'
        : `   ! MANUAL STEP: Setup > Lightning Out 2.0 App Manager > 'Lightning Out App': set Linked Community Site to '${SITE_NAME}'.`);
}

// ---------- 10. what's left ----------

const manual = [];
if (!['External', 'AllowAllFraming'].includes(lwrSite.ClickjackProtectionLevel)) {
    manual.push(`Experience Builder for '${SITE_NAME}' > Settings > Security & Privacy > Clickjack Protection Level: ` +
        "'Allow framing of site pages on external domains (Good protection)', then Publish. Only Experience Builder can set it.");
}
manual.push(
    'ProcessingHub: connect the payment processors in test mode (e.g. Stripe test keys) and activate the payment methods.',
    'Flow Builder: choose the payment methods on the Payment Method Selector of Checkout_Flow, Donation_Flow and Pay_Link_Flow (Pay_Link_Flow ships without a list).',
    'Pay link and portal examples: create the installments they link to (their GUIDs are in the examples\' HTML), or change the links.',
    'Recurring payment links: a guest sharing rule on the recurring object (see the Payment Link template README).',
    'Set each website\'s config.js to the values above and redeploy the websites.',
);

const siteOrigin = query(`SELECT SecureUrl FROM SiteDetail WHERE DurableId = '${lwrSite.Id}'`)[0]?.SecureUrl?.match(/^https:\/\/[^/]+/)?.[0];
console.log(`
Done.

config.js for the examples:

export const LIGHTNING_OUT = {
    orgUrl: '${siteOrigin ?? 'https://<your-domain>.my.site.com'}',
    runtimeUrl: '${orgInfo.instanceUrl}/lightning/lightning.out.latest/index.iife.prod.js',
    sitePrefix: '${SITE_PREFIX}',
    appId: '${appRecord.Id}',
};

Still to do by hand:
${manual.map((line, i) => `${i + 1}. ${line}`).join('\n')}
`);
