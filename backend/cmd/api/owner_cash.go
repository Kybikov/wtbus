package main

func canCollectOwnCash(actor identity) bool {
	return actor.Role == "owner" || actor.Role == "developer"
}
