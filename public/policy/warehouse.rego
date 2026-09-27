# Warehouse open policy. Same rules as src/lib/sim/coverage.ts solve().
# Load with: opa eval -d policy/warehouse.rego -i input.json "data.base.warehouse.allow"

package base.warehouse

default allow := false

phase1_ok if {
  input.spec.phase == 2
}

phase1_ok if {
  input.spec.phase == 1
  input.candidate.county_phase1
}

on_corridor if {
  input.candidate.spur_miles <= input.spec.spur
}

far_enough if {
  input.nearest_open_miles >= input.spec.separation
}

enough_demand if {
  input.uncovered_homes >= input.spec.min_homes
}

staffed if {
  input.techs >= 1
  input.engineers >= 1
}

fits_lot if {
  input.candidate.kind != "leased"
}

fits_lot if {
  input.candidate.kind == "leased"
  input.candidate.sq_ft >= input.spec.min_sqft
}

in_replace_radius if {
  not input.spec.prefer_near
}

in_replace_radius if {
  input.spec.prefer_near
  input.miles_to_outage <= input.spec.max_miles + 10
}

allow if {
  phase1_ok
  on_corridor
  far_enough
  enough_demand
  staffed
  fits_lot
  in_replace_radius
  input.uncovered_homes <= input.techs * input.spec.homes_per_warehouse
}

open_count := count({id |
  some id
  input.open_yards[id]
})
