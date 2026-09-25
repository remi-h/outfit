import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { Pressable, StyleSheet } from 'react-native';

import { Text, View, useThemeColor } from '@/components/Themed';

export default function EmptyState({
  icon = { ios: 'tshirt', android: 'checkroom', web: 'checkroom' },
  title,
  message,
  actionLabel,
  onAction,
}: {
  icon?: SymbolViewProps['name'];
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const tint = useThemeColor({}, 'tint');
  const text = useThemeColor({}, 'text');

  return (
    <View style={styles.container}>
      <SymbolView name={icon} tintColor={text} size={48} style={styles.icon} />
      <Text style={styles.title}>{title}</Text>
      {message ? <Text style={styles.message}>{message}</Text> : null}
      {actionLabel && onAction ? (
        <Pressable
          onPress={onAction}
          accessibilityRole="button"
          style={({ pressed }) => [styles.action, { borderColor: tint, opacity: pressed ? 0.6 : 1 }]}>
          <Text style={[styles.actionText, { color: tint }]}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  icon: {
    marginBottom: 16,
    opacity: 0.4,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
  },
  message: {
    marginTop: 8,
    fontSize: 14,
    opacity: 0.6,
    textAlign: 'center',
  },
  action: {
    marginTop: 20,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
  },
  actionText: {
    fontSize: 15,
    fontWeight: '600',
  },
});
