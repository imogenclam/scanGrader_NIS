package account

import (
	_ "embed"
	"strings"
	"sync"
)

//go:embed disposable_domains.list
var disposableDomainsRaw string

const disposableEmailMsg = "Одноразовая почта не подходит. Укажите постоянную: на неё придут коды входа и уведомления"

var disposableDomains = sync.OnceValue(func() map[string]struct{} {
	m := make(map[string]struct{}, 10000)
	for _, line := range strings.Split(disposableDomainsRaw, "\n") {
		if d := strings.TrimSpace(line); d != "" && !strings.HasPrefix(d, "#") {
			m[strings.ToLower(d)] = struct{}{}
		}
	}
	return m
})

// домен и все родительские: sub.mailinator.com тоже одноразовый
func isDisposableEmail(email string) bool {
	at := strings.LastIndexByte(email, '@')
	if at < 0 {
		return false
	}
	domain := strings.ToLower(strings.TrimSpace(email[at+1:]))
	set := disposableDomains()
	for domain != "" {
		if _, ok := set[domain]; ok {
			return true
		}
		dot := strings.IndexByte(domain, '.')
		if dot < 0 {
			return false
		}
		domain = domain[dot+1:]
	}
	return false
}
