import { FaqSection, HeroSection, QuoteBand, WorkSection } from '@shared/react/canopy';
import { LightningOutEmbed } from '@shared/react/LightningOutEmbed';
import { LIGHTNING_OUT } from '../config';
import { appUrl } from '../appUrl';

/**
 * The page is React; the donation form is the Donation_Flow in Salesforce, rendered by the Lightning Out flow
 * container (c-lightning-out-flow-container) through Lightning Out. Hosted payments (iDEAL, PayPal, ...) return to the React routes below.
 */
export default function Donate() {
  return (
    <main>
      <HeroSection>
        <LightningOutEmbed
          config={LIGHTNING_OUT}
          attributes={{
            'flow-api-name': 'Donation_Flow',
            'success-url': appUrl('/thank-you'),
            'failure-url': appUrl('/failed'),
          }}
        />
      </HeroSection>
      <WorkSection />
      <QuoteBand />
      <FaqSection />
    </main>
  );
}
