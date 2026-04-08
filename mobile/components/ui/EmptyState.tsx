import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Colors, Spacing } from '@/constants/theme';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';

interface Props {
  title: string;
  body?: string;
  ctaLabel?: string;
  onCta?: () => void;
  icon?: React.ReactNode;
}

export function EmptyState({ title, body, ctaLabel, onCta, icon }: Props) {
  return (
    <View style={styles.container}>
      {icon && <View style={styles.icon}>{icon}</View>}
      <Text variant="h3" style={styles.title}>
        {title}
      </Text>
      {body && (
        <Text variant="body" color="secondary" style={styles.body}>
          {body}
        </Text>
      )}
      {ctaLabel && onCta && (
        <Button
          label={ctaLabel}
          onPress={onCta}
          variant="primary"
          size="md"
          style={styles.cta}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing[12],
    paddingHorizontal: Spacing[8],
  },
  icon: {
    marginBottom: Spacing[5],
    opacity: 0.5,
  },
  title: {
    textAlign: 'center',
    color: Colors.primaryText,
  },
  body: {
    textAlign: 'center',
    marginTop: Spacing[2],
    maxWidth: 280,
  },
  cta: {
    marginTop: Spacing[6],
    alignSelf: 'center',
  },
});
