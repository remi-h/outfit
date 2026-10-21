import { ActivityIndicator, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { Text, View, useThemeColor } from '@/components/Themed';
import PressableScale from '@/src/components/PressableScale';
import { EASE_OUT } from '@/src/motion';

// Leaves ~20% faster than it arrives: the arrival needs reading, the exit doesn't.
const BANNER_ENTERING = FadeIn.duration(220).easing(EASE_OUT);
const BANNER_EXITING = FadeOut.duration(170).easing(EASE_OUT);

/**
 * A one-message failure strip with a Retry action, and an optional second
 * action for the cases where retrying is not the fix — "Open Settings" when
 * the forecast failed because location was denied, for instance.
 *
 * Deliberately not a blocking state: it sits above whatever is already on
 * screen so the last good plan keeps rendering underneath it.
 */
export default function ErrorBanner({
  message,
  onRetry,
  retryLabel = 'Retry',
  busy = false,
  onSecondaryAction,
  secondaryLabel,
  style,
}: {
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
  /** Shows a spinner in place of the retry label and blocks repeat taps. */
  busy?: boolean;
  onSecondaryAction?: () => void;
  secondaryLabel?: string;
  /** Overrides the default screen-edge margins when it is nested in a padded layout. */
  style?: StyleProp<ViewStyle>;
}) {
  const text = useThemeColor({}, 'text');

  // The outer view carries the margins and the fade; the inner one the colour.
  return (
    <Animated.View
      entering={BANNER_ENTERING}
      exiting={BANNER_EXITING}
      style={[styles.outer, style]}>
      <View
        accessibilityRole="alert"
        style={styles.container}
        lightColor="#fdecea"
        darkColor="rgba(255,69,58,0.16)">
        <Text style={styles.message} lightColor="#8a1c12" darkColor="#ffb4ad">
          {message}
        </Text>

        {onRetry || (onSecondaryAction && secondaryLabel) ? (
          <View style={styles.actions} lightColor="transparent" darkColor="transparent">
            {onRetry ? (
              <BannerButton
                label={retryLabel}
                busy={busy}
                color={text}
                emphasis
                onPress={onRetry}
              />
            ) : null}
            {onSecondaryAction && secondaryLabel ? (
              <BannerButton label={secondaryLabel} color={text} onPress={onSecondaryAction} />
            ) : null}
          </View>
        ) : null}
      </View>
    </Animated.View>
  );
}

function BannerButton({
  label,
  color,
  onPress,
  busy = false,
  emphasis = false,
}: {
  label: string;
  color: string;
  onPress: () => void;
  busy?: boolean;
  emphasis?: boolean;
}) {
  return (
    <PressableScale
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ busy, disabled: busy }}
      style={[
        styles.button,
        { borderColor: color, borderWidth: emphasis ? 1 : 0, opacity: busy ? 0.5 : 1 },
      ]}>
      {busy ? (
        <ActivityIndicator size="small" color={color} />
      ) : (
        <Text style={[styles.buttonText, { color }]}>{label}</Text>
      )}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  outer: {
    marginHorizontal: 16,
    marginTop: 12,
  },
  container: {
    padding: 14,
    borderRadius: 12,
    gap: 10,
  },
  message: {
    fontSize: 14,
    lineHeight: 19,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  button: {
    minWidth: 76,
    minHeight: 34,
    paddingHorizontal: 14,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    fontSize: 14,
    fontWeight: '600',
  },
});
