# Firestore rules (full app)

Paste this **entire** block into **Firebase Console → Firestore → Rules** and click **Publish**.

Do not keep only the `musicRooms` section — that removes access to `users`, `friendRequests`, and `chats`, which causes `permission-denied` on login.

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function signedIn() {
      return request.auth != null;
    }

    function chatMember(chatId) {
      return signedIn()
        && chatId is string
        && chatId.matches('.*_.*')
        && (request.auth.uid == chatId.split('_')[0]
            || request.auth.uid == chatId.split('_')[1]);
    }

    match /users/{userId} {
      allow read: if signedIn();
      allow create: if signedIn() && request.auth.uid == userId;
      // Own profile + friend accept / unread bumps on the other user
      allow update: if signedIn();
      allow delete: if false;
    }

    match /friendRequests/{requestId} {
      allow read: if signedIn() && (
        resource.data.fromUid == request.auth.uid ||
        resource.data.toUid == request.auth.uid
      );
      allow create: if signedIn()
        && request.resource.data.fromUid == request.auth.uid;
      allow update: if signedIn() && (
        resource.data.fromUid == request.auth.uid ||
        resource.data.toUid == request.auth.uid
      );
      allow delete: if false;
    }

    match /chats/{messageId} {
      allow read: if signedIn() && chatMember(resource.data.chatId);
      allow create: if signedIn()
        && request.resource.data.senderId == request.auth.uid
        && chatMember(request.resource.data.chatId);
      allow update, delete: if signedIn()
        && resource.data.senderId == request.auth.uid;
    }

    match /musicRooms/{chatId} {
      allow read, write: if chatMember(chatId);

      match /queue/{itemId} {
        allow read, write: if chatMember(chatId);
      }
    }
  }
}
```

After publishing, refresh the app. The `permission-denied` errors on `App.jsx` profile / friend-request listeners should clear.
