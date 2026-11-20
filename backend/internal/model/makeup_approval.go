package model

type MakeupApprovalClaim struct {
	ActorID   string        `bson:"actor_id"`
	ActorName string        `bson:"actor_name"`
	Comment   string        `bson:"comment"`
	ClaimedAt int64         `bson:"claimed_at"`
	Checkin   CheckinRecord `bson:"checkin"`
}
