id === (int) $receiverId;
});

Broadcast::channel('online-users', function ($user) {
    return [
        'id'   => $user->id,
        'name' => $user->name,
        'profile_picture' => $user->profile_picture,
    ];
});
*/