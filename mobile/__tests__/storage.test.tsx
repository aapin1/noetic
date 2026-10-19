import * as SecureStore from 'expo-secure-store';
import { clearAuth, mirrorTokenForShareExtension, removeToken, storeToken } from '@/lib/storage';

const setItem = SecureStore.setItemAsync as jest.Mock;
const deleteItem = SecureStore.deleteItemAsync as jest.Mock;

const withGroup = expect.objectContaining({ accessGroup: expect.stringMatching(/^group\./) });

beforeEach(() => {
  setItem.mockClear();
  deleteItem.mockClear();
});

describe('share-extension token mirror', () => {
  it('storeToken writes the session item and a copy the share extension can read', async () => {
    await storeToken('tok-1');
    expect(setItem).toHaveBeenCalledWith('mneme_auth_token', 'tok-1');
    expect(setItem).toHaveBeenCalledWith('mneme_auth_token', 'tok-1', withGroup);
  });

  it('the mirror never fails the caller when the keychain write throws', async () => {
    setItem.mockRejectedValueOnce(new Error('keychain unavailable'));
    await expect(mirrorTokenForShareExtension('tok-2')).resolves.toBeUndefined();
  });

  it('removeToken and clearAuth also drop the shared copy', async () => {
    await removeToken();
    expect(deleteItem).toHaveBeenCalledWith('mneme_auth_token', withGroup);
    deleteItem.mockClear();
    await clearAuth();
    expect(deleteItem).toHaveBeenCalledWith('mneme_auth_token');
    expect(deleteItem).toHaveBeenCalledWith('mneme_auth_token', withGroup);
  });
});
