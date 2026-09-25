import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet } from 'react-native';

import { Text, View } from '@/components/Themed';
import { useAppState } from '@/src/store';

export default function ItemDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { closet, removeItem } = useAppState();
  const [deleting, setDeleting] = useState(false);

  const item = closet.find((candidate) => candidate.id === id);

  const confirmDelete = useCallback(() => {
    if (!item || deleting) return;
    Alert.alert('Delete item?', 'This removes the photo from your closet. It cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          // Set before removing so the screen shows a blank frame rather than
          // flashing "not found" while the modal dismisses.
          setDeleting(true);
          removeItem(item.id);
          router.back();
        },
      },
    ]);
  }, [item, deleting, removeItem, router]);

  if (!item) {
    return (
      <View style={styles.container}>
        {!deleting ? (
          <>
            <Text style={styles.title}>Item not found</Text>
            <Text style={styles.subtitle}>It may have been deleted.</Text>
          </>
        ) : null}
        <StatusBar style={Platform.OS === 'ios' ? 'light' : 'auto'} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Image source={{ uri: item.photoUri }} style={styles.photo} contentFit="contain" transition={120} />

      <View style={styles.meta}>
        <Text style={styles.subtitle}>
          Added {new Date(item.createdAt).toLocaleDateString()} · {item.tagStatus}
        </Text>
      </View>

      <Pressable
        onPress={confirmDelete}
        accessibilityRole="button"
        style={({ pressed }) => [styles.deleteButton, { opacity: pressed ? 0.6 : 1 }]}>
        <Text style={styles.deleteText}>Delete item</Text>
      </Pressable>

      {/* Use a light status bar on iOS to account for the black space above the modal */}
      <StatusBar style={Platform.OS === 'ios' ? 'light' : 'auto'} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  photo: {
    flex: 1,
    width: '100%',
    borderRadius: 12,
  },
  meta: {
    paddingVertical: 16,
    alignItems: 'center',
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  subtitle: {
    fontSize: 14,
    opacity: 0.6,
    marginTop: 4,
  },
  deleteButton: {
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  deleteText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#d0342c',
  },
});
