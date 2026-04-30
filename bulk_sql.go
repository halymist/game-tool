package main

import (
	"fmt"
	"strings"

	"github.com/lib/pq"
)

type bulkColumn struct {
	Name   string
	Cast   string
	Values any
}

func bulkUnnestSelect(columns []bulkColumn) (string, []any) {
	casts := make([]string, len(columns))
	names := make([]string, len(columns))
	args := make([]any, len(columns))

	for i, column := range columns {
		casts[i] = fmt.Sprintf("$%d::%s[]", i+1, column.Cast)
		names[i] = column.Name
		args[i] = pq.Array(column.Values)
	}

	return fmt.Sprintf("SELECT * FROM unnest(%s) AS t(%s)", strings.Join(casts, ", "), strings.Join(names, ", ")), args
}
