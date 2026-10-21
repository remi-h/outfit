import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';

import { transition } from '@/src/motion';

const PRESS_TRANSITION = transition(['transform', 'opacity'], 120);

/**
 * A `Pressable` that dips to 97% the moment a finger lands and springs back on
 * release, so every button in the app answers on press-in rather than after
 * the tap completes.
 *
 * It is a Reanimated CSS transition, not a shared value: the state flips twice
 * per press, never per frame, so a `setState` is the whole implementation.
 * `style` goes on the scaling view — that is the one with the border and
 * background, so the outline shrinks with the label instead of staying put.
 */
export default function PressableScale({
  children,
  style,
  disabled,
  pressTransition = PRESS_TRANSITION,
  ...rest
}: Omit<PressableProps, 'style' | 'children'> & {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Replaces the default press transition — to also crossfade colours, say. */
  pressTransition?: ReturnType<typeof transition>;
}) {
  const [pressed, setPressed] = useState(false);

  return (
    <Pressable
      {...rest}
      disabled={disabled}
      onPressIn={(event) => {
        setPressed(true);
        rest.onPressIn?.(event);
      }}
      onPressOut={(event) => {
        setPressed(false);
        rest.onPressOut?.(event);
      }}
      pressRetentionOffset={16}>
      <Animated.View
        style={[styles.box, pressTransition, style, pressed && !disabled && styles.pressed]}>
        {children}
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  box: {
    transform: [{ scale: 1 }],
  },
  pressed: {
    transform: [{ scale: 0.97 }],
    opacity: 0.85,
  },
});
