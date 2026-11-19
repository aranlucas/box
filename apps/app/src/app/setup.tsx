import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text } from 'react-native';

import { api, setHouseholdKey } from '@/lib/api';
import { refreshHousehold } from '@/lib/household';
import { Banner, Button, Field, Screen, styles } from '@/ui/components';

export default function Setup() {
  const params = useLocalSearchParams<{ key?: string }>();
  const [key, setKey] = useState(params.key ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(value = key) {
    const k = value.trim();
    if (!k) return;
    setBusy(true);
    setError(null);
    try {
      if (!(await api.checkKey(k))) throw new Error('That key was not accepted.');
      await setHouseholdKey(k);
      refreshHousehold();
      router.replace('/');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (params.key) save(params.key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.key]);

  return (
    <Screen>
      <Text style={styles.body}>
        Enter your household key once on this device. Anyone can view a box by scanning its label, but only devices with the key
        can add, edit or print boxes.
      </Text>
      <Field
        label="Household key"
        value={key}
        onChangeText={setKey}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
        onSubmitEditing={() => save()}
        returnKeyType="done"
      />
      {error ? <Banner tone="error">{error}</Banner> : null}
      <Button label="Save" onPress={() => save()} busy={busy} />
    </Screen>
  );
}
