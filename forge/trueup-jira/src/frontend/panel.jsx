// OWNER: C — "AI spend impact (TrueUp)" issue panel.
import React, { useEffect, useState } from 'react';
import ForgeReconciler, { Heading, Lozenge, SectionMessage, Spinner, Stack, Strong, Text } from '@forge/react';
import { invoke } from '@forge/bridge';

const usd = (n) => `$${Math.round(n).toLocaleString('en-US')}`;

const App = () => {
  const [data, setData] = useState(null);
  useEffect(() => {
    invoke('getImpact').then(setData).catch((err) => setData({ error: err.message }));
  }, []);

  if (!data) return <Spinner />;
  if (data.error) {
    return (
      <SectionMessage appearance="warning">
        <Text>{data.error}</Text>
      </SectionMessage>
    );
  }
  return (
    <Stack space="space.100">
      <Heading as="h3">{data.teamLabel} · {data.monthLabel}</Heading>
      <Text>
        TrueUp estimate: <Strong>{data.estimate ? usd(data.estimate.estimate) : 'n/a'}</Strong>{' '}
        {data.estimate && <Lozenge>{data.estimate.confidence}</Lozenge>}
      </Text>
      <Text>
        {data.event
          ? `This issue: ${data.event.multiplier}x from ${data.event.date} (${data.event.note}).`
          : 'This issue adds no spend driver this month.'}
      </Text>
      {data.estimate && <Text>{data.estimate.basis}</Text>}
    </Stack>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
