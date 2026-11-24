package server

import "time"

var loginDelaySlots = make(chan struct{}, 64)

func loginDelay(failures int) time.Duration {
	const free = 4
	if failures <= free {
		return 0
	}
	d := 250 * time.Millisecond << uint(min(failures-free-1, 5))
	if d > 2*time.Second {
		d = 2 * time.Second
	}
	return d
}

func applyLoginDelay(d time.Duration) bool {
	if d <= 0 {
		return true
	}
	select {
	case loginDelaySlots <- struct{}{}:
		time.Sleep(d)
		<-loginDelaySlots
		return true
	default:
		return false
	}
}
