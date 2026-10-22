package main
import ("net/http"; "os")
func main() { http.ListenAndServe(":"+os.Getenv("PORT"), nil) }
