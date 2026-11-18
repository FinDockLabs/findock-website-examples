# Salesforce setup for the Lightning Out examples

What the org needs so websites can embed FinDock's flows with Lightning Out 2.0. The flows themselves come from the
[FinDock payment experiences templates](https://github.com/FinDockLabs/payment-experiences-templates); this folder only has what embedding adds. Used by
`examples/html-lightning-out-donation`, `examples/html-lightning-out-checkout`,
`examples/html-lightning-out-checkout-page`, `examples/html-lightning-out-pay-link` and
`examples/react-multi-framework-lightning-out`.

| Path | What it is |
|---|---|
| `lwc/donationFlow` | `c-donation-flow`: runs `Donation_Flow` with `lightning-flow`, takes `success-url` / `failure-url`, posts its height to the host page |
| `lwc/invoicePayFlow` | `c-invoice-pay-flow`: runs `Checkout_Flow` for an installment (`installment-guid`), same messages |
| `lwc/payLinkFlow` | `c-pay-link-flow`: runs `Pay_Link_Flow` (`record-guid`, `link-type`, `invoice-url`, `merchant-name`), same messages |
| `lightningOutApps/Lightning_Out_App` | The Lightning Out 2.0 app: lists every component the flows render (wrappers, template components, FinDock components). A component missing here fails to load inside Lightning Out. It lists the components for an org that runs every example (Checkout, NPSP donation and Payment Link templates). Each listed component must exist in the org, or the deploy fails: in an org with only some templates, remove the others' components (each template's README lists them); for a Fundraising donation flow add `c-transaction-fee-opt-in` |
| `cspTrustedSites`, `corsWhitelistOrigins` | Examples for trusting a website (`https://www.example.org`): copy per website |
| `lightning-out-site` (next to `force-app`) | The Lightning Out site itself (LWR, URL prefix `lightningout`), for a new org. Only the setup script deploys it, with your websites filled in, so it never overwrites a site an org already has |

## Prerequisites

- FinDock installed, with ProcessingHub connected and payment methods active.
- The flows from the [FinDock payment experiences templates](https://github.com/FinDockLabs/payment-experiences-templates). Each example needs one:

  | Example | Flow | Template package |
  |---|---|---|
  | `html-lightning-out-donation`, `react-multi-framework-lightning-out` | `Donation_Flow` | one of FinDock Experiences - NPSP, - Fundraising or - Fundraising UK |
  | `html-lightning-out-checkout-page` | `Checkout_Flow` | FinDock Experiences - Checkout |
  | `html-lightning-out-checkout`, `html-lightning-out-pay-link` | `Pay_Link_Flow` | FinDock Experiences - Payment Link (and its `FinDockLabs_Pay_Link_Flow_Guest_Access` permission set) |

  Get them in one of two ways:

  - **Install the packages**, one org per example set. The Checkout package and the donation packages contain the
    same shared components (`getUserAgentInfo`, `UserAgentInfo`), so they can't be installed in the same org. Use one
    org for the donation examples (a donation package) and another for the checkout and pay link examples (Checkout
    and Payment Link). Payment Link has no shared components and installs next to either.
  - **Deploy the templates from source**, for one org that runs every example. Clone the templates repository and
    deploy the template folders; source isn't owned by a package, so the shared components are deployed once:

    ```bash
    sf project deploy start -o <alias> \
      -d sfdx-source/packages/checkout \
      -d sfdx-source/packages/donation-npsp \
      -d sfdx-source/packages/pay-link
    ```

    Pick the donation folder that fits your org (`donation-npsp`, `donation-fundraising` or
    `donation-fundraising-uk`). Don't mix the two ways in one org: a component that an installed package owns can't
    also be deployed from source.

  After either, follow each template's README: choose the payment methods in Flow Builder, assign its guest
  permission set, and replace the example success and failure URLs. The wrappers pass the website's own
  `successUrl` and `failureUrl` to the flows, so the example URLs only apply when a flow runs on its own.
- The styles from the site templates: `checkoutStyles` (checkout, checkout page and pay link examples) from FinDock
  Experiences - Checkout Site, and `canopyStyles` with the Canopy logos and icons (donation examples) from FinDock
  Experiences - Donation Site. Both also ship `findockAssets`. They style the flows inside Lightning Out too: the
  website's CSS doesn't reach into the frame. Install the site package in the matching org (it needs its flow
  packages and Payment Link first), or, in an org deployed from source, deploy only the stylesheets:

  ```bash
  sf project deploy start -o <alias> \
    -d sfdx-source/packages/checkout-site/staticresources \
    -d sfdx-source/packages/donation-site/staticresources
  ```
- A **Lightning Out** Experience Cloud site (LWR) with URL prefix `lightningout`, guest access enabled, and its guest
  user assigned the FinDock Payer permission set group and each template's guest permission set. In its Head Markup,
  load the FinDock styles and the site templates' stylesheets (leave out the one an org doesn't have):

  ```html
  <link rel="stylesheet" href="{ basePath }/sfsites/c/resource/findockAssets/dxp-styles.css?{ versionKey }" />
  <link rel="stylesheet" href="{ basePath }/sfsites/c/resource/checkoutStyles?{ versionKey }" />
  <link rel="stylesheet" href="{ basePath }/sfsites/c/resource/canopyStyles?{ versionKey }" />
  ```

## Deploy

After the templates (see Prerequisites):

```bash
cd salesforce
# The Lightning Out app needs API 68 or later (this project's sourceApiVersion).
sf project deploy start -o <alias> -d force-app
sf community publish -o <alias> --name "Lightning Out"
```

Then, for each website that embeds a flow, trust its address: see
[Trust your website in Salesforce](../examples/html-lightning-out-donation/README.md#trust-your-website-in-salesforce).
A React app hosted on the same Experience Cloud domain needs none of that.

## Set up a demo org with the script

`scripts/setup-demo-org.mjs` sets up one org that runs every example, deployed from source:

1. Chatter, Digital Experiences and ExperienceBundle metadata on; your websites allowed in CORS, CSP and Lightning Out framing
2. FinDock, ProcessingHub, the processors and FinDock for Fundraising (or NPSP and FinDock for NPSP with the NPSP
   donation flow): checks they're installed, or installs them when the config has their package version Ids
3. The Checkout, donation and Payment Link templates, and the site templates' stylesheets, logos and icons, from a
   clone of [payment-experiences-templates](https://github.com/FinDockLabs/payment-experiences-templates)
4. The Lightning Out site from `lightning-out-site`, unless the org already has one
5. The wrapper components and the Lightning Out app from `force-app`
6. Publishes the site, gives its guest user the FinDock Payer permission set group and the templates' guest
   permission sets, and links the Lightning Out app to the site
7. Prints the `config.js` values for the websites and the steps that are left to do by hand

```bash
cp scripts/demo-org.config.example.json scripts/demo-org.config.json
# Set targetOrg (an sf alias), templatesRepo, donationTemplate and your websites
node scripts/setup-demo-org.mjs --dry-run   # validates everything, changes nothing
node scripts/setup-demo-org.mjs
```

The example config uses the Fundraising donation flow, for a Nonprofit Cloud org: for example a Partner Developer
Edition created in the Environment Hub from Salesforce's Nonprofit Cloud Trialforce template. That org needs Person
Accounts (the Fundraising flows create the donor as a person account). Set `donationTemplate` to `donation-npsp` for
an NPSP org.

Every step checks the org first, so you can run it again after fixing a failure. `--update-site` also overwrites an
existing Lightning Out site from `lightning-out-site`. `scripts/demo-org.config.json` is ignored by git.

Left to do by hand (the script lists them): connect the payment processors in test mode in ProcessingHub, choose the
payment methods in the flows' Payment Method Selector, create the installments the pay link and portal examples link
to, and, in a new site, set Clickjack Protection to "Allow framing of site pages on external domains" in Experience
Builder (only Experience Builder can set it).

## Sharing an org

If several people use the same org for Lightning Out demos, **merge** into the Lightning Out app's component list and
the site's trusted domains instead of replacing them, and give wrapper components specific names (`c-invoice-pay-flow`,
not `c-pay-flow`). Deploying this folder's `Lightning_Out_App` replaces the whole component list.
