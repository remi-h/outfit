import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  StyleSheet,
} from 'react-native';
import type { ImagePickerAsset } from 'expo-image-picker';

import { Text, View, useThemeColor } from '@/components/Themed';
import ClosetGrid from '@/src/components/ClosetGrid';
import EmptyState from '@/src/components/EmptyState';
import { importAsset, pickFromCamera, pickFromLibrary, type PickResult } from '@/src/photos';
import { useAppState } from '@/src/store';
import type { ClosetItem } from '@/src/types';

type Source = 'camera' | 'library';

export default function ClosetScreen() {
  const router = useRouter();
  const { closet, addItems } = useAppState();
  const tint = useThemeColor({}, 'tint');

  const [importing, setImporting] = useState<{ done: number; total: number } | null>(null);

  const runImport = useCallback(
    async (assets: ImagePickerAsset[]) => {
      setImporting({ done: 0, total: assets.length });
      let failures = 0;

      // Sequential on purpose: eight parallel resizes will push Expo Go into
      // memory pressure. Each item lands in the grid as soon as it is saved.
      for (let index = 0; index < assets.length; index += 1) {
        const asset = assets[index];
        try {
          const { id, photoUri } = await importAsset(asset.uri, {
            width: asset.width,
            height: asset.height,
          });
          const item: ClosetItem = {
            id,
            photoUri,
            createdAt: new Date().toISOString(),
            tags: null,
            tagStatus: 'pending',
          };
          addItems([item]);
        } catch (error) {
          failures += 1;
          console.warn('[closet] import failed', asset.uri, error);
        }
        setImporting({ done: index + 1, total: assets.length });
        // Give the UI a frame to paint the new item and the progress count.
        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      setImporting(null);
      if (failures > 0) {
        Alert.alert(
          failures === assets.length ? "Couldn't add photos" : 'Some photos failed',
          `${failures} of ${assets.length} ${failures === 1 ? 'photo' : 'photos'} could not be imported.`
        );
      }
    },
    [addItems]
  );

  const handleDenied = useCallback((source: Source, canAskAgain: boolean) => {
    const what = source === 'camera' ? 'the camera' : 'your photo library';
    Alert.alert(
      'Permission needed',
      canAskAgain
        ? `Outfit needs access to ${what} to add clothing items. Tap Add again to allow it.`
        : `Outfit doesn't have access to ${what}. You can turn it on in Settings › Outfit (or Expo Go).`
    );
  }, []);

  const addFrom = useCallback(
    async (source: Source) => {
      if (importing) return;
      let result: PickResult;
      try {
        result = source === 'camera' ? await pickFromCamera() : await pickFromLibrary();
      } catch (error) {
        console.warn('[closet] picker failed', error);
        Alert.alert('Something went wrong', "The picker couldn't be opened. Please try again.");
        return;
      }

      if (result.status === 'denied') {
        handleDenied(source, result.canAskAgain);
        return;
      }
      if (result.status === 'cancelled') return;

      await runImport(result.assets);
    },
    [importing, handleDenied, runImport]
  );

  const promptForSource = useCallback(() => {
    if (importing) return;

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: 'Add clothing',
          options: ['Take photo', 'Choose from library', 'Cancel'],
          cancelButtonIndex: 2,
        },
        (index) => {
          if (index === 0) void addFrom('camera');
          if (index === 1) void addFrom('library');
        }
      );
      return;
    }

    Alert.alert('Add clothing', undefined, [
      { text: 'Take photo', onPress: () => void addFrom('camera') },
      { text: 'Choose from library', onPress: () => void addFrom('library') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [importing, addFrom]);

  const openItem = useCallback(
    (item: ClosetItem) => {
      router.push(`/item/${item.id}`);
    },
    [router]
  );

  return (
    <View style={styles.container}>
      {closet.length === 0 && !importing ? (
        <EmptyState
          title="Your closet is empty"
          message="Add photos of your clothes to get started."
          actionLabel="Add clothing"
          onAction={promptForSource}
        />
      ) : (
        <ClosetGrid items={closet} onPressItem={openItem} contentInsetBottom={96} />
      )}

      {importing ? (
        <View style={styles.progress} lightColor="rgba(0,0,0,0.75)" darkColor="rgba(72,72,74,0.95)">
          <ActivityIndicator size="small" color="#fff" />
          <Text style={styles.progressText} lightColor="#fff" darkColor="#fff">
            Importing {Math.min(importing.done + 1, importing.total)}/{importing.total}…
          </Text>
        </View>
      ) : null}

      <Pressable
        onPress={promptForSource}
        disabled={!!importing}
        accessibilityRole="button"
        accessibilityLabel="Add clothing"
        style={({ pressed }) => [
          styles.fab,
          { backgroundColor: tint, opacity: importing ? 0.4 : pressed ? 0.8 : 1 },
        ]}>
        <Text style={styles.fabText} lightColor="#fff" darkColor="#000">
          Add
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 24,
    minWidth: 76,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fabText: {
    fontSize: 16,
    fontWeight: '700',
  },
  progress: {
    position: 'absolute',
    left: 20,
    bottom: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
  },
  progressText: {
    fontSize: 14,
    fontWeight: '600',
  },
});
